// notification.js
// FIXED: timezone parse, past-date guard, error propagation, BREATH_ID race,
//        scheduleTaskReminder return contract, navigate-away cancellation,
//        input validation, non-swallowed errors, boot cleanup, sticky restored.
//
// Fixes applied (per audit):
//   #2  — scheduleTaskReminder: parse targetDate as LOCAL date, not UTC
//   #3  — past-date guard: build local-midnight today and target; compare
//   #7  — scheduleTaskReminder: returns null on validation failure; App.js
//         uses a per-task mutex in-flight tracker
//   #8  — cancelTaskReminder: returns boolean, does NOT swallow errors
//   #11 — sticky: true restored (unintentional change reverted)
//   #20 — BREATH_ID_KEY race: getAllScheduledNotificationsAsync cleanup
//         runs both on cancel and on every schedule (defense in depth)
//   N4  — boot-time cancellation of stale notifications
//   N5  — empty-date load cancels old OS notifications
//   N6  — fix "2m" highlight comparison (use tolerance)
//   N7  — cross-day zombie reminder cleanup on boot/date change
//   N10 — parallel unregisterNotif for performance
//   N12 — remove dead code exports
//
// New helpers exported:
//   - cancelAllTaskRemindersForDate(targetDate)
//   - cancelAllTaskReminders()
//   - cancelAllTaskRemindersExceptDate(targetDate)

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BREATH_CHANNEL_ID = 'breath-reminders';
const TASK_CHANNEL_ID = 'task-reminders';
const BREATH_NOTIFICATION_TITLE = 'Do you have focus on your breath';
const BREATH_ID_KEY = 'breathReminderNotifId';
// Persistent map of task notification ids we own. Lets us cancel cleanly
// after app kill/restart even if React state is gone.
const TASK_NOTIF_REGISTRY_KEY = 'taskNotificationRegistry';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function ensureChannel(channelId, name) {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(channelId, {
      name,
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#7c6aff',
      enableVibrate: true,
      enableLights: true,
      showBadge: true,
      sound: 'default',
    });
  } catch (e) {
    console.warn('[notifications] ensureChannel failed', channelId, e);
  }
}

export async function setupNotifications(onPress) {
  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return () => {};

  await ensureChannel(BREATH_CHANNEL_ID, 'Breath Reminders');
  await ensureChannel(TASK_CHANNEL_ID, 'Task Reminders');

  if (onPress) {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      onPress(response);
    });
    return () => {
      if (subscription) {
        try { subscription.remove(); } catch (e) {}
      }
    };
  }
  return () => {};
}

// ---------- Registry helpers (track every task notif we schedule) ----------

async function readRegistry() {
  try {
    const raw = await AsyncStorage.getItem(TASK_NOTIF_REGISTRY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}

async function writeRegistry(reg) {
  try {
    await AsyncStorage.setItem(TASK_NOTIF_REGISTRY_KEY, JSON.stringify(reg));
  } catch (e) {
    console.warn('[notifications] writeRegistry failed', e);
  }
}

async function registerNotif(id, meta) {
  const reg = await readRegistry();
  reg[id] = { ...meta, registeredAt: Date.now() };
  await writeRegistry(reg);
}

async function unregisterNotif(id) {
  const reg = await readRegistry();
  if (reg[id]) {
    delete reg[id];
    await writeRegistry(reg);
  }
}

// ---------- Date helpers (local-timezone safe) ----------

// Parse "YYYY-MM-DD" into { year, month (0-based), day } WITHOUT timezone shift.
function parseLocalYMD(dateStr) {
  if (typeof dateStr !== 'string') return null;
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10) - 1;
  const day = parseInt(m[3], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return { year, month, day };
}

// Build a local-midnight Date for the given YMD. Avoids the UTC-parse bug
// where `new Date("2025-11-04")` shifts the day in non-UTC zones.
function localMidnight({ year, month, day }) {
  return new Date(year, month, day, 0, 0, 0, 0);
}

// Clamp hour/minute to valid range.
function clampTime(hour, minute) {
  let h = Math.floor(Number(hour));
  let m = Math.floor(Number(minute));
  if (!Number.isFinite(h)) h = 0;
  if (!Number.isFinite(m)) m = 0;
  if (h < 0) h = 0;
  if (h > 23) h = 23;
  if (m < 0) m = 0;
  if (m > 59) m = 59;
  return { hour: h, minute: m };
}

// ---------- Breath reminder ----------

export async function scheduleBreathReminder(intervalHours) {
  await cancelBreathReminder();
  if (!intervalHours || intervalHours <= 0) return null;

  const seconds = Math.round(intervalHours * 3600);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;

  try {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: BREATH_NOTIFICATION_TITLE,
        body: 'Tap to log your somatic awareness.',
        sound: true,
        priority: Notifications.AndroidNotificationPriority.HIGH,
        sticky: true,  // FIX #11: restored to true
        data: { type: 'somatic_reminder' },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds,
        repeats: true,
        channelId: BREATH_CHANNEL_ID,
      },
    });
    try { await AsyncStorage.setItem(BREATH_ID_KEY, id); } catch (e) {
      console.warn('[notifications] store BREATH_ID_KEY failed', e);
    }
    return id;
  } catch (e) {
    console.error('[notifications] scheduleBreathReminder failed', e);
    return null;
  }
}

export async function cancelBreathReminder() {
  try {
    const id = await AsyncStorage.getItem(BREATH_ID_KEY);
    if (id) {
      try {
        await Notifications.cancelScheduledNotificationAsync(id);
      } catch (e) {
        console.warn('[notifications] cancel BREATH_ID_KEY id failed', e);
      }
      await AsyncStorage.removeItem(BREATH_ID_KEY);
    }

    // Defense in depth: nuke any stray somatic_reminder notifications.
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const immortals = scheduled.filter(
      (n) => n?.content?.data?.type === 'somatic_reminder'
    );
    await Promise.all(
      immortals.map((n) =>
        Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {})
      )
    );
  } catch (e) {
    console.error('[notifications] cancelBreathReminder failed', e);
  }
}

// ---------- Task reminder (one-shot) ----------

export async function scheduleTaskReminder(
  taskText,
  hour,
  minute,
  taskId,
  domain,
  targetDate
) {
  // FIX #29: validate inputs first.
  if (!taskId || !targetDate) {
    console.warn('[notifications] scheduleTaskReminder: missing taskId or targetDate');
    return null;
  }
  const ymd = parseLocalYMD(targetDate);
  if (!ymd) {
    console.warn('[notifications] scheduleTaskReminder: bad targetDate', targetDate);
    return null;
  }
  const t = clampTime(hour, minute);

  // FIX #3: build today-midnight and target-midnight in LOCAL time.
  const now = new Date();
  const todayMidnight = localMidnight({
    year: now.getFullYear(),
    month: now.getMonth(),
    day: now.getDate(),
  });
  const targetDayMidnight = localMidnight(ymd);

  // Reject only if the target day is strictly BEFORE today. Equal is OK
  // (means "today" — the time-of-day check below handles whether to bump).
  if (targetDayMidnight.getTime() < todayMidnight.getTime()) {
    return null;
  }

  // FIX #2: build target time in LOCAL time from local YMD.
  const targetTime = new Date(ymd.year, ymd.month, ymd.day, t.hour, t.minute, 0, 0);
  
  // FIX #N7: Check if time has passed. If so, DO NOT schedule (return null).
  // This prevents cross-day zombie reminders.
  if (targetTime.getTime() <= now.getTime()) {
    console.warn('[notifications] scheduleTaskReminder: target time is in the past, not scheduling');
    return null;
  }

  const secondsUntilTarget = Math.floor((targetTime.getTime() - now.getTime()) / 1000);
  if (secondsUntilTarget <= 0 || !Number.isFinite(secondsUntilTarget)) {
    return null;
  }

  try {
    const id = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Task Reminder',
        body: taskText || 'Time for your task',
        sound: true,
        priority: Notifications.AndroidNotificationPriority.HIGH,
        sticky: true,
        data: { 
          type: 'today_task',
          taskId: taskId,
          domain: domain || 'Personal Growth',
          targetDate: targetDate
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: secondsUntilTarget,
        repeats: false,
        channelId: TASK_CHANNEL_ID,
      },
    });
    
    // Register the notification for later cleanup
    await registerNotif(id, { taskId, domain, targetDate });
    
    return id;
  } catch (e) {
    console.error('[notifications] scheduleTaskReminder failed', e);
    return null;
  }
}

// FIX #8: returns boolean; does NOT swallow errors. Caller decides what to do.
export async function cancelTaskReminder(id) {
  if (!id) return false;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch (e) {
    console.error('[notifications] cancelTaskReminder failed for id', id, e);
    // Even if the OS call failed, drop our local registry entry so we
    // don't keep retrying a phantom id forever.
    await unregisterNotif(id);
    return false;
  }
  await unregisterNotif(id);
  return true;
}

// FIX #1: cancel all task reminders for a specific date (used on navigate-away).
export async function cancelAllTaskRemindersForDate(targetDate) {
  try {
    const reg = await readRegistry();
    const idsToCancel = Object.entries(reg)
      .filter(([_, info]) => info && info.targetDate === targetDate)
      .map(([id]) => id);
    
    // Cancel all notifications for this date
    await Promise.all(
      idsToCancel.map((id) =>
        Notifications.cancelScheduledNotificationAsync(id).catch((e) => {
          console.warn('[notifications] cancel failed for id', id, e);
        })
      )
    );
    
    // Remove from registry
    await Promise.all(
      idsToCancel.map((id) => unregisterNotif(id).catch(() => {}))
    );
    
    return idsToCancel.length;
  } catch (e) {
    console.error('[notifications] cancelAllTaskRemindersForDate failed', e);
    return 0;
  }
}

// FIX #N4: cancel all task reminders (used on boot).
export async function cancelAllTaskReminders() {
  try {
    const reg = await readRegistry();
    const allIds = Object.keys(reg);
    
    // Cancel all notifications
    await Promise.all(
      allIds.map((id) =>
        Notifications.cancelScheduledNotificationAsync(id).catch((e) => {
          console.warn('[notifications] cancel failed for id', id, e);
        })
      )
    );
    
    // Clear entire registry
    await AsyncStorage.removeItem(TASK_NOTIF_REGISTRY_KEY);
    
    return allIds.length;
  } catch (e) {
    console.error('[notifications] cancelAllTaskReminders failed', e);
    return 0;
  }
}

// FIX #N7: cancel all task reminders EXCEPT those for a specific date.
// Used on boot/date change to keep only today's reminders.
export async function cancelAllTaskRemindersExceptDate(targetDate) {
  try {
    const reg = await readRegistry();
    const idsToCancel = Object.entries(reg)
      .filter(([_, info]) => info && info.targetDate !== targetDate)
      .map(([id]) => id);
    
    // Cancel all notifications NOT for this date
    await Promise.all(
      idsToCancel.map((id) =>
        Notifications.cancelScheduledNotificationAsync(id).catch((e) => {
          console.warn('[notifications] cancel failed for id', id, e);
        })
      )
    );
    
    // Remove from registry
    await Promise.all(
      idsToCancel.map((id) => unregisterNotif(id).catch(() => {}))
    );
    
    return idsToCancel.length;
  } catch (e) {
    console.error('[notifications] cancelAllTaskRemindersExceptDate failed', e);
    return 0;
  }
}
