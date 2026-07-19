import { useRegisterSW } from 'virtual:pwa-register/react';

// Controlled service-worker update (PWA-PLAN.md Slice 6).
//
// The worker is registered with registerType:'prompt' and skipWaiting:false, so
// a new build installs and then sits in `waiting` instead of seizing live tabs.
// This component is the only thing that lets it through, and only when the user
// says so — never mid-referral, and never while work is still queued locally.
//
// `onNeedRefresh` fires when a new worker is waiting; `updateServiceWorker(true)`
// posts SKIP_WAITING and reloads once the new worker takes control.
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <div className="update-bar" role="status" data-testid="update-prompt">
      <span>A new version is available.</span>
      <span className="update-actions">
        <button
          type="button"
          className="update-btn"
          data-testid="update-reload"
          onClick={() => void updateServiceWorker(true)}
        >
          Reload
        </button>
        <button
          type="button"
          className="update-dismiss"
          data-testid="update-dismiss"
          onClick={() => setNeedRefresh(false)}
        >
          Later
        </button>
      </span>
    </div>
  );
}
