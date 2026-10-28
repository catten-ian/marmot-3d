# Headless Chrome self-test startup evidence

Attempt 1 command:
`/usr/bin/google-chrome --headless=new --no-sandbox --disable-dev-shm-usage --disable-gpu --remote-debugging-port=9230 --user-data-dir=/tmp/m3d-fixall-chrome-<timestamp> --no-first-run --no-default-browser-check`

Result: process exited before `http://127.0.0.1:9230/json/version` became available after 30 seconds. `chrome.stderr` and `chrome.stdout` are empty.

Attempt 2 command:
`/usr/bin/google-chrome --headless=new --no-sandbox --disable-dev-shm-usage --disable-gpu --remote-debugging-port=9231 --user-data-dir=/tmp/m3d-fixall-chrome-retry-<timestamp> --no-first-run --no-default-browser-check --no-zygote --single-process --disable-crash-reporter`

Result: process terminated with `Segmentation fault (core dumped)`; stderr contained three `Cannot use V8 Proxy resolver in single process mode` lines followed by a DevTools listening line, but the endpoint was unavailable by the 8-second probe.

Additional attempts on ports 9232 and 9233 (headless=new with unsafe SwiftShader, and headless=old) also exited before the DevTools endpoint became available. Full stdout/stderr are stored beside this file.
