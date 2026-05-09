"""Run OpenAlex CLI on Windows without Unix signal handlers.

The current OpenAlex CLI downloader registers signal handlers via asyncio.
That API is not implemented by the default Windows event loop, so direct
`openalex download ...` exits before downloading anything. This wrapper keeps
the CLI behavior intact and only turns those signal hooks into no-ops.
"""

from __future__ import annotations

import asyncio

from openalex_cli.cli import main


def _ignore_signal_handler(self, *args, **kwargs):  # noqa: ANN001, ANN002, ANN003
    return None


asyncio.BaseEventLoop.add_signal_handler = _ignore_signal_handler
asyncio.BaseEventLoop.remove_signal_handler = _ignore_signal_handler


if __name__ == "__main__":
    main()
