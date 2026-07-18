import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BREATH_CHANNEL_ID = 'breath-reminders';
const TASK_CHANNEL_ID = 'task-reminders';
const BREATH_NOTIFICATION_TITLE = 'Do you have focus on your breath';
// Stores the active breath-reminder notification id so we can cancel just it
// without touching task reminders (cancelAllScheduledNotifications would wipe both).
const BREATH_ID_KEY = 'breathReminderNotifId';

// Configure how notifications appear while the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Ensure a notification channel exists on Android (no-op elsewhere).
 */
async function ensureChannel(channelId, name) {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(channelId, {
      name,
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#7c6aff',
    });
  } catch (e) {
    // Channel may already exist; ignore.
  }
}

/**
 * Request notification + alert permissions and (Android) ensure the
 * reminder channels exist. Returns true if permissions granted.
 */
export async function setupNotifications(onPress) {
  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return false;

  await ensureChannel(BREATH_CHANNEL_ID, 'Breath Reminders');
  await ensureChannel(TASK_CHANNEL_ID, 'Task Reminders');

  // Tap → route the app to the Somatic tab.
  if (onPress) {
    Notifications.addNotificationResponseReceivedListener((response) => {
      onPress();
    });
  }
  return true;
}

/**
 * Schedule a repeating breath-focus notification. Pass intervalHours of 0,
 * null, or a non-positive value to cancel. Fractional hours are accepted
 * (e.g. 2/60 schedules a 2-minute test reminder).
 */
export async function scheduleBreathReminder(intervalHours) {
  await cancelBreathReminder();
  if (!intervalHours || intervalHours <= 0) return null;

  const seconds = Math.round(intervalHours * 3600);
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: BREATH_NOTIFICATION_TITLE,
      body: 'Tap to log your somatic awareness.',
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds,
      repeats: true,
      channelId: BREATH_CHANNEL_ID,
    },
  });
  try { await AsyncStorage.setItem(BREATH_ID_KEY, id); } catch (e) { /* ignore */ }
  return id;
}

export async function cancelBreathReminder() {
  try {
    const id = await AsyncStorage.getItem(BREATH_ID_KEY);
    if (id) {
      await Notifications.cancelScheduledNotificationAsync(id);
      await AsyncStorage.removeItem(BREATH_ID_KEY);
    }
  } catch (e) { /* ignore */ }
}

/**
 * Schedule a daily task reminder at the given local wall-clock time.
 * hour: 0-23, minute: 0-59. Uses a calendar trigger so it fires at the
 * same time every day even if the app is closed. Returns the notif id.
 */
export async function scheduleTaskReminder(taskText, hour, minute) {
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Task Reminder',
      body: taskText || 'Time for your task',
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
      hour,
      minute,
      repeats: true,
      channelId: TASK_CHANNEL_ID,
    },
  });
  return id;
}

/** Cancel a specific task reminder by its stored notification id. */
export async function cancelTaskReminder(id) {
  if (!id) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch (e) { /* ignore */ }
}

/**
 * Get the count of scheduled notifications currently registered with the OS.
 * Returns the number of scheduled notifications, or -1 if the API is not available.
 */
export async function getScheduledNotificationsCount() {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    return scheduled ? scheduled.length : 0;
  } catch (e) {
    return -1;
  }
}
