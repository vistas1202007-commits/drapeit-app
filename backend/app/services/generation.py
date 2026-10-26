"""Runs generators and records each run as a "generation job".

A job stores: which generator ran, on which design version, which provider was
used, whether it was a mock, the output, and any error. This is what lets the
UI show loading/success/error states, retry failed jobs and mark outputs as
out of date.
"""

from __future__ import annotations

import logging
import time
from datetime import UTC, datetime
from typing import Any

from pydantic import ValidationError

from app.generators.registry import (
    GENERATORS_BY_ID,
    PACKAGE_ORDER,
    GeneratorContext,
    GeneratorInputError,
)
from app.config import Settings
from app.providers.base import GeneratedImage, ProviderError, UsageMeter
from app.providers.registry import Providers
from app.schemas.api import GenerationJob, PackageResult, PackageStepResult
from app.schemas.design_spec import DesignSpec, changed_fields
from app.schemas.outputs import DesignConceptOutput
from app.storage.files import StorageError, SupabaseStorage
from app.storage.knowledge_repository import KnowledgeRepository
from app.storage.repository import NotFoundError, Repository, SystemRepository, new_id

IMAGE_EXTENSIONS = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/svg+xml": ".svg"}

log = logging.getLogger(__name__)


class UnknownGeneratorError(Exception):
    pass


class GeneratorUnavailableError(Exception):
    pass


def start_of_today() -> datetime:
    """Midnight of today in the server's own time zone (UTC on most hosts)."""
    local_midnight = datetime.now().astimezone().replace(hour=0, minute=0, second=0, microsecond=0)
    return local_midnight.astimezone(UTC)


class GenerationService:
    """Runs generators for one signed-in user (the user's `repo`)."""

    def __init__(self, repo: Repository, system: SystemRepository, store: SupabaseStorage,
                 providers: Providers, settings: Settings, knowledge: KnowledgeRepository | None = None) -> None:
        self.repo = repo
        self.knowledge = knowledge
        self.system = system
        self.store = store
        self.providers = providers
        self.settings = settings

    def _budget_problem(self, estimate: float) -> str | None:
        spent = self.system.paid_spend_since(start_of_today())
        budget = self.settings.daily_budget_usd
        if spent + estimate > budget:
            return (
                f"Daily spending limit reached: about ${spent:.2f} of ${budget:.2f} used today. "
                "Paid AI is paused until tomorrow. The app owner can raise DAILY_BUDGET_USD in the backend settings."
            )
        return None

    def _image_saver(self, project_id: str, job_id: str, generator_id: str, version: int, provider: str, is_mock: bool):
        def save(image: GeneratedImage, label: str) -> str:
            ext = IMAGE_EXTENSIONS.get(image.mime_type)
            if ext is None:
                raise ProviderError(f"Unsupported image type {image.mime_type}.")
            data = image.data if image.data is not None else (image.svg or "").encode("utf-8")
            asset_id = new_id()
            path = self.repo.storage_path(project_id, asset_id, ext)
            self.store.put(path, data, image.mime_type)
            self.repo.add_asset(
                project_id, "generated", f"{label}-v{version}{ext}", image.mime_type, len(data), path,
                asset_id=asset_id, job_id=job_id, generator_id=generator_id, version_number=version,
                provider=provider, is_mock=is_mock,
            )
            return asset_id

        return save

    def _asset_loader(self):
        def load(asset_id: str) -> tuple[bytes, str] | None:
            try:
                asset, path = self.repo.get_asset_with_path(asset_id)
                return self.store.get(path), asset.mime_type
            except (NotFoundError, StorageError):
                return None  # the picture was deleted, or cannot be fetched right now

        return load

    def run(self, project_id: str, generator_id: str, options: dict[str, Any]) -> GenerationJob:
        definition = GENERATORS_BY_ID.get(generator_id)
        if definition is None:
            raise UnknownGeneratorError(generator_id)
        if definition.run is None or definition.provider is None:
            raise GeneratorUnavailableError(
                f"{definition.name} is planned for Phase {definition.phase} and is not available yet."
            )
        version = self.repo.current_version(project_id)
        info = definition.provider(self.providers)
        job = self.repo.create_job(project_id, generator_id, version.version_number, info.name, info.is_mock, options)

        started = time.monotonic()
        output: dict[str, Any] | None = None
        error: str | None = None
        meter = UsageMeter()
        ctx = GeneratorContext(
            spec=version.spec, options=options, providers=self.providers, meter=meter,
            save_image=self._image_saver(
                project_id, job.id, generator_id, version.version_number, info.name, info.is_mock
            ),
            latest_output=lambda gid: self.repo.latest_output(project_id, gid),
            project_assets=lambda: self.repo.list_assets(project_id),
            load_asset=self._asset_loader(), budget_problem=self._budget_problem, knowledge_repo=self.knowledge,
        )
        try:
            if info.paid and (problem := self._budget_problem(info.estimated_cost_usd)):
                raise GeneratorInputError(problem)
            result = definition.run(ctx)
            output = result.model_dump(mode="json")
        except GeneratorInputError as exc:
            error = str(exc)
        except ProviderError as exc:
            error = f"The {info.name} provider failed: {exc}"
        except StorageError as exc:
            error = str(exc)
        except ValidationError:
            log.exception("Provider %s returned invalid output", info.name)
            error = "The provider returned data in an unexpected format. Please retry."
        except Exception:  # noqa: BLE001 - we never want one generator to crash the server
            log.exception("Generator %s crashed", generator_id)
            error = "Something went wrong while generating. Please retry."
        duration = int((time.monotonic() - started) * 1000)
        self.system.record_usage(
            self.repo.user_id, job.id, definition.service, info.name, info.is_mock, error is None, duration, error,
            estimated_cost_usd=round(meter.cost_usd, 6), paid=info.paid,
        )
        return self.repo.finish_job(job.id, output, error)

    def retry(self, project_id: str, job_id: str) -> GenerationJob:
        old = self.repo.get_job(project_id, job_id)
        return self.run(project_id, old.generator_id, self.repo.get_job_options(job_id))

    def apply_design(self, project_id: str, job_id: str) -> int:
        """Save the spec proposed by a Generate Design job as a new design version."""
        job = self.repo.get_job(project_id, job_id)
        if job.generator_id != "design" or job.status != "succeeded" or not job.output:
            raise GeneratorInputError("Only a successful Generate Design result can be applied.")
        concept = DesignConceptOutput.model_validate(job.output)
        version = self.repo.add_version(project_id, concept.proposed_spec, "Applied from Generate Design")
        return version.version_number

    def run_package(
        self, project_id: str, generator_ids: list[str], options: dict[str, dict[str, Any]]
    ) -> PackageResult:
        """Generate Complete Design Package: run the chosen generators in a sensible order."""
        steps: list[PackageStepResult] = []
        wanted = set(generator_ids)
        for gid in wanted - set(PACKAGE_ORDER):
            definition = GENERATORS_BY_ID.get(gid)
            reason = (
                f"Planned for Phase {definition.phase}." if definition else "Unknown generator."
            )
            steps.append(PackageStepResult(generator_id=gid, status="skipped", reason=reason))
        for gid in PACKAGE_ORDER:
            if gid not in wanted:
                continue
            job = self.run(project_id, gid, options.get(gid, {}))
            if job.status == "succeeded" and gid == "design":
                # The other generators must use the new concept, so save it as a version.
                self.apply_design(project_id, job.id)
            steps.append(
                PackageStepResult(
                    generator_id=gid,
                    status="succeeded" if job.status == "succeeded" else "failed",
                    job_id=job.id,
                    reason=job.error,
                )
            )
        return PackageResult(steps=steps)

    def mark_stale(self, project_id: str, jobs: list[GenerationJob], current: DesignSpec) -> list[GenerationJob]:
        """Flag outputs whose design inputs changed after they were generated."""
        spec_cache: dict[int, DesignSpec] = {}
        for job in jobs:
            definition = GENERATORS_BY_ID.get(job.generator_id)
            if job.status != "succeeded" or definition is None:
                continue
            if job.version_number not in spec_cache:
                spec_cache[job.version_number] = self.repo.get_version(project_id, job.version_number).spec
            diff = changed_fields(spec_cache[job.version_number], current) & set(definition.depends_on)
            job.stale = bool(diff)
            job.stale_fields = sorted(diff)
        return jobs
