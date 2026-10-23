import type { Metadata } from "next";
import { Suspense } from "react";
import { ChatView } from "@/components/chat/ChatView";
import { Spinner } from "@/components/ui/Spinner";

// The chat id comes from the address (/messages/<id>), so it is read inside <Suspense>.
export const instant = false;

export const metadata: Metadata = { title: "Chat" };

export default function ChatPage({ params }: PageProps<"/messages/[id]">) {
  return (
    <Suspense
      fallback={
        <p className="flex items-center gap-2 px-8 py-10 text-sm text-muted">
          <Spinner /> Opening chat…
        </p>
      }
    >
      <ChatRoute params={params} />
    </Suspense>
  );
}

async function ChatRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ChatView id={id} />;
}
