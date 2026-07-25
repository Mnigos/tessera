# GitHub Cutover

Use this guide when moving a GitHub-mirrored repository to Tessera as the source of truth.

## Before Cutover

1. Pick a short cutover window and ask teammates to pause pushes to GitHub.
2. Finish, merge, or record any GitHub PR, issue, or comment context the team still needs.
3. Verify the latest GitHub-to-Tessera synchronization completed successfully and freshness
   is current in Tessera. Webhooks are primary; backend reconciliation repairs missed events.
4. Compare the default branch HEAD on both remotes:

```bash
git ls-remote https://<github-host>/<owner>/<repo>.git <branch>
git ls-remote https://<tessera-host>/<owner>/<repo>.git <branch>
```

The commit hashes should match. If they do not, postpone cutover. Do not use a user-facing
manual sync; wait for backend reconciliation or ask an administrator to investigate or replay
the synchronization path.

## Cutover Steps

1. Cut over the repository in Tessera.
2. Announce that Tessera is now the source of truth.
3. Ask every teammate to switch `origin` to Tessera.
4. Verify fetch and push access from at least one teammate machine.
5. Keep GitHub read-only or clearly marked as historical if it stays visible.

## Remote Commands

| Protocol | Switch `origin` to Tessera |
| --- | --- |
| HTTPS | `git remote set-url origin https://<tessera-host>/<owner>/<repo>.git` |
| SSH | `git remote set-url origin ssh://git@<tessera-host>/<owner>/<repo>.git` |

After switching, verify the remote:

```bash
git remote -v
git fetch origin
```

## Push Verification

Verify the current branch can push to Tessera:

```bash
git push origin HEAD:<branch>
git ls-remote origin <branch>
```

The pushed branch should resolve to the expected commit on the Tessera remote.

## MVP Limits

| GitHub data | MVP behavior |
| --- | --- |
| Open PRs | Not migrated. Finish or record them before cutover. |
| Issues | Not migrated. Keep GitHub available for history or copy needed context manually. |
| Comments | Not migrated. Preserve important discussion before cutover. |
| Push-back mirror to GitHub | Not included in the MVP. Tessera does not update GitHub after cutover. |

## Mirror Behavior After Cutover

Before cutover, `github_to_tessera` means GitHub is authoritative. Verified webhooks keep
Tessera current and backend scheduled reconciliation repairs gaps. Tessera is read-only,
rejects Git writes, and presents GitHub HTTPS and SSH clone URLs. There is no frontend
scheduler, manual sync, or Tessera-to-GitHub push-back.

Cutover records `tessera_source`. Inbound webhooks and scheduled reconciliation stop for that
repository, clone guidance switches to Tessera, and direct pushes to Tessera are allowed
through normal repository permissions.

Pushing new commits to GitHub after cutover does not move them into Tessera. Push to Tessera instead.

## Read-only inspection

If a teammate switched too early or needs to inspect GitHub history, use a separate remote or
temporarily set `origin` to GitHub for fetch-only inspection:

| Protocol | Switch `origin` back to GitHub |
| --- | --- |
| HTTPS | `git remote set-url origin https://<github-host>/<owner>/<repo>.git` |
| SSH | `git remote set-url origin ssh://git@<github-host>/<owner>/<repo>.git` |

Then verify:

```bash
git remote -v
git fetch origin
git ls-remote origin <branch>
```

Do not push to GitHub after cutover. Compare branch heads without mutating either remote. If
GitHub must become authoritative again, create a new import or mirror through the supported
administrative flow.

Cutover is intentionally irreversible. Returning to GitHub authority requires creating a new
import or mirror; it is not a mode rollback. The complete contract is in
`docs/adr/0002-github-authoritative-synchronization.md`.
