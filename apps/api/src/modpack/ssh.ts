import { existsSync } from "node:fs";

// The ssh command rsync uses to reach the AMP host with the deploy key (docs/13 §4).
//
// docs/31 B-23: the host key used to be trusted afresh at every start of the container (`accept-new`, with
// known_hosts in the container's own home). With a pinned file next to the key it is checked strictly; without
// one it is as before, so a host that has not made the file yet keeps working. deploy.sh says how to make it.

const KNOWN_HOSTS = process.env.DEPLOY_KNOWN_HOSTS ?? "/run/keys/known_hosts";

export function sshCommand(keyPath: string, connectTimeoutS: number, knownHosts: string = KNOWN_HOSTS, pinned: boolean = existsSync(knownHosts)): string {
  const host = pinned ? `-o UserKnownHostsFile=${knownHosts} -o StrictHostKeyChecking=yes` : "-o StrictHostKeyChecking=accept-new";
  return `ssh -i ${keyPath} -o IdentitiesOnly=yes -o BatchMode=yes ${host} -o ConnectTimeout=${connectTimeoutS}`;
}
