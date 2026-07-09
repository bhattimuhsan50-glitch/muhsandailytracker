import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const BREATH_CHANNEL_ID = 'breath-reminders';
const BREATH_NOTIFICATION_TITLE = 'Do you have focus on your breath';

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
 * Request notification + alert permissions and (Android) ensure the
 * breath-reminder channel exists. Returns true if permissions granted.
 */
export async function setupNotifications(onPress) {
  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return false;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(BREATH_CHANNEL_ID, {
      name: 'Breath Reminders',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#7c6aff',
    });
  }

  // Tap → route the app to the Somatic tab.
  if (onPress) {
    Notifications.addNotificationResponseReceivedListener(() => onPress());
  }
  return true;
}

/**
 * Schedule a repeating breath-focus notification. Pass intervalHours of 0
 * or null to cancel.
 */
export async function scheduleBreathReminder(intervalHours) {
  await cancelBreathReminder();
  if (!intervalHours || intervalHours <= 0) return null;

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: BREATH_NOTIFICATION_TITLE,
      body: 'Tap to log your somatic awareness.',
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: Math.round(intervalHours * 3600),
      repeats: true,
      channelId: BREATH_CHANNEL_ID,
    },
  });
  return id;
}

export async function cancelBreathReminder() {
  await Notifications.cancelAllScheduledNotificationsAsync();
}
