import { readFile } from "node:fs/promises";
import path from "node:path";

// docs/42 §5.3: the test site says what it runs, the images' commit and the checkout's. The test checkout's .git is
// mounted read-only into api-test (deploy/docker-compose.yml), and this reads its HEAD without running git: HEAD names
// a branch, whose commit is in its own file or, after a `git gc`, in packed-refs.

const SHA = /^[0-9a-f]{40}$/;

export async function checkoutCommit(repoDir: string): Promise<string | null> {
  const git = path.join(repoDir, ".git");
  try {
    const head = (await readFile(path.join(git, "HEAD"), "utf8")).trim();
    if (SHA.test(head)) return head; // detached
    const ref = /^ref: (refs\/heads\/[A-Za-z0-9._/-]{1,200})$/.exec(head)?.[1];
    if (!ref || ref.includes("..")) return null;
    const loose = await readFile(path.join(git, ref), "utf8").then((s) => s.trim()).catch(() => null);
    if (loose && SHA.test(loose)) return loose;
    const packed = await readFile(path.join(git, "packed-refs"), "utf8").catch(() => "");
    for (const line of packed.split("\n")) {
      const [sha, name] = line.trim().split(" ");
      if (name === ref && sha && SHA.test(sha)) return sha;
    }
    return null;
  } catch {
    return null;
  }
}
