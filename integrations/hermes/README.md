# Partner-Mem for Hermes

Partner-Mem is an exclusive Hermes `MemoryProvider`. The adapter owns Hermes lifecycle
translation, while the bundled Partner-Mem runtime owns storage, verified recall, and
tool execution.

## Requirements

- Hermes Agent v0.18.2. Other Hermes versions require a separately verified adapter release.
- Node.js 20 or newer, including `npm`.
- macOS, Linux, or Windows on `x64` or `arm64`.

Termux/Android is not supported in this release because the locked native SQLite
runtime does not publish an Android build.

## Install

Publish the built `partner_mem` artifact as the root of a standalone Git repository.
Install that repository and activate the memory provider:

```sh
hermes plugins install <owner>/partner-mem-hermes --enable
hermes memory setup partner_mem
```

The setup command installs the runtime's locked production dependency and stores memory
inside the active Hermes profile. Start a new Hermes session after setup completes.

## Update

End active CLI sessions and stop any running gateway before updating. Update the
standalone repository, rerun setup so the locked Node dependency is reinstalled,
then restart the gateway when applicable:

```sh
hermes gateway stop
hermes plugins update partner_mem
hermes memory setup partner_mem
hermes gateway restart
```

Skip the gateway commands when no gateway service is configured.

## Disable or uninstall

End active CLI sessions and stop any running gateway. Disable external memory before
removing the plugin, then restart the gateway when applicable:

```sh
hermes gateway stop
hermes memory off
hermes plugins remove partner_mem
hermes gateway restart
```

Removal keeps `$HERMES_HOME/partner_mem.json` and
`$HERMES_HOME/partner-mem/partner-mem.db`. The first file is the profile-scoped
adapter configuration; the second is the memory database. Delete them separately
only when the retained configuration and memories are intentionally no longer needed.

## V1 capabilities

- capture completed primary-session turns;
- inject verified raw evidence during recall;
- expose Partner-Mem search, recall, timeline, and status tools;
- isolate memory by trusted Hermes agent and session identity.

Typed extraction is not available in the Hermes V1 provider because Hermes does not expose
its model service to exclusive memory providers. The adapter does not claim that capability.
