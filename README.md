# betterpi

Small, open-source tunings for [pi](https://pi.dev). Each one does one visible thing well.

## Tunings

| Tuning | What you get |
|---|---|
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
