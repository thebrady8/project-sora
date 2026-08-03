export function createDebouncedRequest(delayMs = 250) {
  let timeoutId = null;
  let latestRequestId = 0;

  function schedule(callback) {
    latestRequestId += 1;
    const requestId = latestRequestId;

    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      timeoutId = null;
      callback(requestId);
    }, delayMs);

    return requestId;
  }

  function runNow(callback) {
    latestRequestId += 1;
    const requestId = latestRequestId;

    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    callback(requestId);
    return requestId;
  }

  function isLatest(requestId) {
    return requestId === latestRequestId;
  }

  function cancel() {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  }

  return { schedule, runNow, isLatest, cancel };
}
