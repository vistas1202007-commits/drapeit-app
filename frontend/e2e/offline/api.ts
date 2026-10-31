export const api = {
  async getStitchingProgress() {
    return { version_number: 1, done_keys: JSON.parse(localStorage.getItem("fixture-ticks") || "[]") as string[] };
  },
  async setStitchingStep(_project: string, _version: number, key: string, done: boolean) {
    const keys = new Set<string>(JSON.parse(localStorage.getItem("fixture-ticks") || "[]"));
    if (done) keys.add(key); else keys.delete(key);
    localStorage.setItem("fixture-ticks", JSON.stringify([...keys]));
    return { version_number: 1, done_keys: [...keys] };
  },
};
