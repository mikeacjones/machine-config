# Commit and pull request style

This applies to every commit you create and every pull request you open or
edit, in every repository, including merge commits and draft PRs. The model is
the style of Temporal's own sdk-core and sdk-go repositories. Follow the style;
don't name or link those repositories in a commit or PR.

Where a repository has its own commit convention or pull request template,
that takes precedence; apply the rest of this wherever it doesn't conflict.

A reader who has only the commit or the PR must learn what changed, why, and
how it was checked. A subject line alone is not enough for anything but a
trivial change (a typo, a version bump, a release preparation commit).

## Commits

- **Subject:** one imperative sentence that names the behavior that changed,
  capitalized, no trailing period, about 72 characters at most. Say what the
  code now does, for example "Fix stale worker slot metrics during polling",
  "Allow configuring the default RPC timeout", "Only advertise the worker
  control queue when polling". Not "Fix bug", "Updates", "Address review", or
  an issue or task ID on its own.
- **Body:** plain prose wrapped at 72 columns, separated from the subject by a
  blank line. First the problem or the gap: what was wrong or missing, and
  who it affects. Then the approach: what the code does now and the mechanism,
  and why this approach where another was plausible. Then anything a reader
  must know: behavior that deliberately stays the same, compatibility or
  replay impact, and limits. Name the real types, functions, options and
  files. Two to four short paragraphs is typical.
- A commit that fixes review findings or a failed check describes the defect
  and the fix themselves, not "review feedback".
- A merge commit has a body too: one paragraph on what the merged branch adds
  and why, then a "Testing" line listing the checks that passed on the merge.
- Keep issue and task IDs out of the subject unless the repository's history
  already puts them there. Put them in a trailer line at the end of the body,
  such as "Refs: <id>".
- Don't add Claude or Claude Code attribution: no co-author trailer, no
  "Generated with" line, no session link.

## Pull requests

- **Title:** written like a commit subject.
- **Body:** these sections, in this order, under these headings:

  ```markdown
  ## What was changed

  - One bullet per user-visible or structural change, naming the option,
    type, function, or file and the new behavior.
  - Tests, docs and changelog updates get their own bullets.

  ## Why?

  A short paragraph: the problem users or maintainers had, and why this
  change solves it. Mention alternatives you rejected when it matters.

  ## Checklist

  1. Closes: the issue this resolves, or "N/A" with one clause.
  2. How was this tested: the exact commands you ran and their results,
     which platforms or modes, and plainly what you did not run.
  3. Any docs updates needed: what you updated, or what still needs it.
  ```

- A draft PR opened only to run CI still gets the full body; say in "Why?"
  that it is a pre-landing run and how the change will be merged.
- When the branch changes after the PR is opened, update the body so it
  still describes what the PR contains.
- Report tests honestly: a skipped suite, a flaky rerun, or a check you
  could not run goes in item 2.

## Before you commit or open a PR

Reread the message as someone who has not seen the task. If it doesn't answer
what changed, why, and how it was verified, rewrite it. Don't amend or
rewrite commits that are already pushed.
