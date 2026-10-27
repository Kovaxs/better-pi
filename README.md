# betterpi

Small, open-source tunings for [pi](https://pi.dev). Each one does one visible thing well.

## Tunings

| Tuning                                     | What you get                                                 |
| ------------------------------------------ | ------------------------------------------------------------ |
| [`sub-meter`](tunings/sub-meter/README.md) | Subscription usage windows and reset times above the prompt. |

## Install

Install every tuning:

```sh
pi install git:github.com/<owner>/betterpi
```

Or load only the tunings you want with a package filter in your pi settings:

```json
{
  "packages": [
    {
      "source": "git:github.com/<owner>/betterpi",
      "extensions": ["tunings/sub-meter/index.ts"]
    }
  ]
}
```

To try the whole package locally without installing it:

```sh
pi -e .
```

## Credits

betterpi is inspired by [betterclaude](https://github.com/midudev/better-claude) ([betterclaude.dev](https://betterclaude.dev/)) by [@midudev](https://github.com/midudev). It is not a port or a fork: betterclaude's tunings target Claude Code, and this project is an independent adaptation of the same idea — small, single-purpose, community tunings — built natively for [pi](https://pi.dev) and its extension APIs. Some tunings reimagine concepts from betterclaude, but every line here is written for pi.

If you use Claude Code, check out the original: it's the project that inspired this one.
