# projects-status

A Claude Code mod that shows a live **Projects** pane with the git status of every child repo, whenever your session runs in a folder that holds projects.

Open a session in the parent folder where you keep your repos (`~/Projects`, `~/work`, wherever) and the pane lists each child repo, sorted by most recent commit:

- dirty/clean indicator and `✚N` count of uncommitted changes
- `↑`/`↓` ahead/behind the upstream
- branch name, shown only when it is not `main`/`master`
- last commit age and subject
- repos with no commits in 30 days are dimmed

It rescans every 5 minutes, on the pane's **Refresh** button, or with the `/projects-status` command.

## Activation

No configuration. The mod activates only when the session's working directory is **not** itself a git repository but holds repos within two levels: child directories that are git repos, grandchild repos under grouping folders (`~/Projects/rails/blog` shows as `rails/blog`), or a mix of both. In any other session it does nothing.

## Install

At the prompt of a terminal session:

```
/plugin install projects-status --marketplace vicmaster/projects-status
```

Then `y` to add the marketplace, and pick a scope (user scope installs it for all your sessions).

From a shell:

```
claude plugin install projects-status --marketplace vicmaster/projects-status
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `vicmaster/projects-status`, then **Add plugin**.

## Development

```
claude --plugin-dir . # load from the working copy
claude plugin test .  # run the tests
claude plugin validate .
```

## License

MIT
