# GitHub Cutover

Use this guide when moving a GitHub-mirrored repository to Tessera as the source of truth.

## Before Cutover

1. Pick a short cutover window and ask teammates to pause pushes to GitHub.
2. Finish, merge, or record any GitHub PR, issue, or comment context the team still needs.
3. Verify the latest GitHub-to-Tessera sync completed successfully in Tessera.
4. Compare the default branch HEAD on both remotes:

```bash
git ls-remote https://<github-host>/<owner>/<repo>.git <branch>
git ls-remote https://<tessera-host>/<owner>/<repo>.git <branch>
```

The commit hashes should match. If they do not match, run a manual sync before cutover and wait for it to finish.

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

Before cutover, scheduled GitHub-to-Tessera sync and manual sync keep Tessera current with GitHub.

After cutover, Tessera is the source of truth. Scheduled GitHub mirror sync stops for that repository, manual GitHub sync is no longer available, and direct pushes to Tessera are allowed through normal repository permissions.

Pushing new commits to GitHub after cutover does not move them into Tessera. Push to Tessera instead.

## Recovery

If a teammate switched too early or must temporarily return to GitHub, set `origin` back to GitHub:

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

If commits were made while `origin` pointed at Tessera, compare branch heads before pushing anywhere. Push only after the team agrees which remote has the correct history.
