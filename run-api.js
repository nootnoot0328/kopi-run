/* Kopi Run collaborative-run client.
   Keeps network behavior behind one small boundary so the existing drink,
   roster and UI logic do not need to know which backend we use.

   Set window.KOPI_RUN_API_BASE before loading this file when a backend exists.
   Example:
     window.KOPI_RUN_API_BASE =
       "https://<project-ref>.supabase.co/functions/v1/run-api";
*/
(function () {
  const base = () => String(window.KOPI_RUN_API_BASE || "").replace(/\/$/, "");

  function configured() {
    return Boolean(base());
  }

  async function request(path, options) {
    if (!configured()) {
      throw new Error("Kopi Run collaborative backend is not configured yet.");
    }

    const response = await fetch(base() + path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options && options.headers ? options.headers : {}),
      },
    });

    let payload = null;
    try { payload = await response.json(); } catch (_) {}

    if (!response.ok) {
      const message =
        payload && payload.error ? payload.error : "Kopi Run request failed.";
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }

    return payload;
  }

  async function createRun(input) {
    return request("", {
      method: "POST",
      body: JSON.stringify({
        action: "create_run",
        group_name: input && input.groupName ? input.groupName : null,
        closes_at: input && input.closesAt ? input.closesAt : null,
      }),
    });
  }

  async function getRun(shareToken, runnerKey) {
    const params = new URLSearchParams({ token: shareToken });
    if (runnerKey) params.set("runner_key", runnerKey);
    return request("?" + params.toString(), { method: "GET" });
  }

  async function submitOrder(shareToken, order) {
    return request("", {
      method: "POST",
      body: JSON.stringify({
        action: "submit_order",
        token: shareToken,
        display_name: order.displayName,
        drink: order.drink,
      }),
    });
  }

  async function updateOrder(shareToken, editToken, order) {
    return request("", {
      method: "POST",
      body: JSON.stringify({
        action: "update_order",
        token: shareToken,
        edit_token: editToken,
        display_name: order.displayName,
        drink: order.drink,
      }),
    });
  }

  async function closeRun(shareToken, runnerKey) {
    return request("", {
      method: "POST",
      body: JSON.stringify({
        action: "close_run",
        token: shareToken,
        runner_key: runnerKey,
      }),
    });
  }

  window.KopiRunAPI = {
    configured,
    createRun,
    getRun,
    submitOrder,
    updateOrder,
    closeRun,
  };
})();
