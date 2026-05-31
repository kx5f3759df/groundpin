// ============================================================
// GroundPin — App State + Location Lifecycle Controller
// ============================================================
//
// Manages the location update lifecycle:
//   - Starts location updates when app is active AND main screen focused
//   - Stops immediately on background / inactive / screen unfocused
//   - 1-second polling interval
// ============================================================

import { AppState, AppStateStatus } from 'react-native';

type LocationLifecycleCallbacks = {
  onStart: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
};

/**
 * Create a controller that manages location updates based on
 * AppState (active/inactive/background) and screen focus.
 *
 * The controller exposes:
 *   - activate():  call when entering MainScreen
 *   - deactivate(): call when leaving MainScreen
 *   - destroy():   call on unmount to clean up listeners
 */
export function createLocationLifecycle(
  callbacks: LocationLifecycleCallbacks,
) {
  let isScreenFocused = false;
  let isAppActive = AppState.currentState === 'active';
  let isUpdating = false;
  let destroyed = false;

  const shouldBeUpdating = () => isScreenFocused && isAppActive && !destroyed;

  async function startIfNeeded() {
    if (shouldBeUpdating() && !isUpdating) {
      isUpdating = true;
      await callbacks.onStart();
    }
  }

  async function stopIfNeeded() {
    if (!shouldBeUpdating() && isUpdating) {
      isUpdating = false;
      await callbacks.onStop();
    }
  }

  const handleAppStateChange = (nextState: AppStateStatus) => {
    if (destroyed) {
      return;
    }

    const wasActive = isAppActive;
    isAppActive = nextState === 'active';

    if (wasActive && !isAppActive) {
      // Transitioned from active to inactive/background
      stopIfNeeded();
    } else if (!wasActive && isAppActive) {
      // Transitioned from inactive/background to active
      startIfNeeded();
    }
  };

  const subscription = AppState.addEventListener(
    'change',
    handleAppStateChange,
  );

  return {
    /** Call when MainScreen is focused / mounted */
    activate() {
      if (destroyed) {
        return;
      }
      isScreenFocused = true;
      startIfNeeded();
    },

    /** Call when MainScreen is unfocused / unmounted */
    deactivate() {
      if (destroyed) {
        return;
      }
      isScreenFocused = false;
      stopIfNeeded();
    },

    /** Call on component unmount to clean up */
    destroy() {
      destroyed = true;
      isScreenFocused = false;
      isUpdating = false;
      subscription.remove();
      callbacks.onStop();
    },

    /** Whether location updates are currently active */
    get isActive() {
      return isUpdating;
    },
  };
}

export type LocationLifecycle = ReturnType<typeof createLocationLifecycle>;
