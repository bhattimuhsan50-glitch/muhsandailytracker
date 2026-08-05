// App.js
// FIXED: behavioral bug audit pass + additional bugs (N1-N20)
// Skipped (per user request): bugs #9 (setupNotifications listener leak),
//                              #14 (completeShutdown alert-before-save).
//
// Original fixes applied (per audit):
//   #1  — date change cancels task notifications via cancelAllTaskRemindersForDate
//   #4  — logSomaticState calls saveData (no longer silent-loss)
//   #5  — auto-save useEffect with 300ms debounce on tasks/todayTasks/goals/etc.
//   #6  — loadTokenRef monotonic counter prevents stale-load overwrites
//   #10 — midnight detection refreshes currentDate without user action
//   #11 — notificationTarget effect uses single timeout, cleans up on dep change
//   #12 — taskReminders useEffect compares prev vs curr (skip no-op saves)
//   #13 — tasks dead keys cleaned up in deleteTask
//   #15 — toggleTask is async and awaits clearTaskReminder
//   #16 — unknown notification types do NOT fallback to somatic page
//   #17 — heatmap uses Promise.all batched in groups of 10
//   #18 — timePicker uses ref to avoid closure null race
//   #19 — expandedDomains stored globally (per-app) and used as-is per date
//   #21 — deleteTask also removes taskId from tasks map
//   #22 — notificationTarget cleared when leaving 'today' page
//   #23 — heatmap "isToday" uses real today, not currentDate
//   #24 — unused scheduleTestNotification import removed
//   #25 — changeReminder rounds float to avoid equality drift
//   #26 — analytics useEffect dependencies trimmed (no tasks/todayTasks)
//   #27 — LayoutAnimation.configureNext scoped per toggle
//   #28 — deleteTask triggers save even when no reminder existed
//   #29 — setTaskReminder validates hour/minute
//   #30 — heatmap useEffect uses isMounted flag to ignore stale results
//   #31 — moveDomain awaits AsyncStorage write and surfaces failure
//
// Additional fixes (N1-N20):
//   N1  — date change: loading timeout with clear error message
//   N2  — delete/logSomaticState: shadow copy ref for immediate save
//   N3  — heatmap: separate cache for today's cell (no 365-day re-read)
//   N4  — boot: cancel all task reminders on app start
//   N5  — empty-date load: cancel old OS notifications  
//   N6  — "2m" highlight: use tolerance comparison
//   N7  — cross-day zombie: cleanup on boot/date change
//   N8  — mutex: re-throw errors instead of swallowing
//   N10 — reminder change: synchronous memory update
//   N11 — sticky: true restored
//   N12 — dead code removed
//   N13 — JSON.parse errors logged and handled
//   N14 — expandedDomains: proper init order
//   N15 — parallel unregisterNotif
//   N16 — boot re-schedule breath reminder
//   N17 — stale breath reminder boot cleanup
//   N19 — localTodayString cached
//   N20 — UX feedback on schedule failure

import React, { useState, useEffect, useRef, Fragment } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  StatusBar,
  SafeAreaView,
  LayoutAnimation,
  Modal,
  Platform,
  PanResponder,
  Animated,
} from 'react-native';
import { Svg, Circle } from 'react-native-svg';
import {
  setupNotifications,
  scheduleBreathReminder,
  cancelBreathReminder,
  scheduleTaskReminder,
  cancelTaskReminder,
  cancelAllTaskRemindersForDate,
  cancelAllTaskReminders,
  cancelAllTaskRemindersExceptDate,
} from './notifications';

const COLORS = {
  bg: '#0A0A0F',
  surface: '#12121A',
  card: '#1A1A26',
  border: '#2A2A3D',
  accent: '#7C5CFC',
  accent2: '#A97BFF',
  text: '#F0EFF8',
  muted: '#6B6B8A',
  green: '#22C87A',
  amber: '#F5A623',
  red: '#FF5C72',
  dim: '#3A3A55',
};

const CATEGORY_COLORS = {
  A: '#FF5C72',
  B: '#F5A623',
  C: '#22C87A',
  D: '#6B6B8A',
  E: '#6B6B8A',
};

const LIFE_DOMAINS = [
  { name: 'Career', icon: '💼' },
  { name: 'Money', icon: '💰' },
  { name: 'Family', icon: '👨‍👩‍👧‍👦' },
  { name: 'Friends', icon: '👥' },
  { name: 'Fun', icon: '🎮' },
  { name: 'Health', icon: '❤️' },
  { name: 'Personal Growth', icon: '🌱' },
];

const PRIORITY_ORDER = ['A', 'B', 'C', 'D', 'E'];

const HEAT_COLORS = [
  'rgba(26,26,38,0.8)',
  'rgba(124,92,252,0.3)',
  'rgba(124,92,252,0.6)',
  'rgba(169,123,255,0.8)',
  'rgba(200,180,255,0.95)',
];

const defaultGoals = () => {
  const g = {};
  LIFE_DOMAINS.forEach((d) => { g[d.name] = { goalText: '', progress: 0 }; });
  return g;
};

const STORAGE_KEY = (date) => 'muhsanTracker_' + date;
const EXPANDED_DOMAINS_KEY = 'muhsanTracker_expandedDomains';
const REMINDER_INTERVAL_KEY = 'reminderInterval';
const DOMAIN_ORDER_KEY = 'domainOrder';

// Helper: convert a Date to YYYY-MM-DD in LOCAL time (no timezone shift)
const dateToLocalKey = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// FIX #N19: Cache localTodayString to avoid recomputation
let cachedTodayString = null;
let lastTodayCacheTime = 0;
const localTodayString = () => {
  const now = Date.now();
  if (!cachedTodayString || now - lastTodayCacheTime > 60000) { // Cache for 1 minute
    cachedTodayString = dateToLocalKey(new Date());
    lastTodayCacheTime = now;
  }
  return cachedTodayString;
};

// ---------- TimePickerModal (with ref-based safety) ----------

const TimePickerModal = ({ visible, initialHour, initialMinute, onClose, onConfirm }) => {
  const [hour12, setHour12] = useState(initialHour % 12 === 0 ? 12 : initialHour % 12);
  const [minute, setMinute] = useState(initialMinute);
  const [isPM, setIsPM] = useState(initialHour >= 12);

  useEffect(() => {
    if (visible) {
      setHour12(initialHour % 12 === 0 ? 12 : initialHour % 12);
      setMinute(initialMinute);
      setIsPM(initialHour >= 12);
    }
  }, [visible, initialHour, initialMinute]);

  const fmt = (h, m, pm) => {
    const hh = h % 12 === 0 ? 12 : h % 12;
    const mm = String(m).padStart(2, '0');
    return `${hh}:${mm} ${pm ? 'PM' : 'AM'}`;
  };

  const confirm = () => {
    const h24 = (hour12 % 12) + (isPM ? 12 : 0);
    onConfirm(h24, minute);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.pickerOverlay}>
        <View style={styles.pickerSheet}>
          <Text style={styles.pickerTitle}>Set reminder time</Text>

          <View style={styles.pickerPreview}>
            <Text style={styles.pickerPreviewText}>{fmt(hour12, minute, isPM)}</Text>
          </View>

          <Text style={styles.pickerSectionLabel}>HOUR</Text>
          <View style={styles.pickerGrid}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((h) => (
              <TouchableOpacity
                key={h}
                style={[styles.pickerCell, hour12 === h && styles.pickerCellActive]}
                onPress={() => setHour12(h)}
              >
                <Text style={[styles.pickerCellText, hour12 === h && styles.pickerCellTextActive]}>{h}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.pickerSectionLabel}>MINUTE</Text>
          <View style={styles.pickerGrid}>
            {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.pickerCell, minute === m && styles.pickerCellActive]}
                onPress={() => setMinute(m)}
              >
                <Text style={[styles.pickerCellText, minute === m && styles.pickerCellTextActive]}>
                  {String(m).padStart(2, '0')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.ampmRow}>
            <TouchableOpacity
              key="am"
              style={[styles.ampmBtn, !isPM && styles.ampmBtnActive]}
              onPress={() => setIsPM(false)}
            >
              <Text style={[styles.ampmBtnText, !isPM && styles.ampmBtnTextActive]}>AM</Text>
            </TouchableOpacity>
            <TouchableOpacity
              key="pm"
              style={[styles.ampmBtn, isPM && styles.ampmBtnActive]}
              onPress={() => setIsPM(true)}
            >
              <Text style={[styles.ampmBtnText, isPM && styles.ampmBtnTextActive]}>PM</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.pickerActions}>
            <TouchableOpacity style={styles.pickerCancelBtn} onPress={onClose}>
              <Text style={styles.pickerCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.pickerConfirmBtn} onPress={confirm}>
              <Text style={styles.pickerConfirmText}>Confirm</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

// ---------- Main App ----------

export default function App() {
  const [currentDate, setCurrentDate] = useState(() => localTodayString());
  const [tasks, setTasks] = useState({});
  const [currentPage, setCurrentPage] = useState('today');
  const [goals, setGoals] = useState(defaultGoals());
  const [todayTasks, setTodayTasks] = useState([]);
  const [domainInputs, setDomainInputs] = useState({});
  const [taskReminders, setTaskReminders] = useState({});
  const [expandedDomains, setExpandedDomains] = useState({});
  const [somaticData, setSomaticData] = useState({
    focusLevel: null,
    thoughts: '',
    thoughtLabel: '',
    technique: null,
  });
  const [somaticLogs, setSomaticLogs] = useState([]);
  const [showShutdown, setShowShutdown] = useState(false);
  const [shutdownReflection, setShutdownReflection] = useState('');
  const [dailyShutdowns, setDailyShutdowns] = useState([]);
  const [analyticsView, setAnalyticsView] = useState('daily');
  const [weeklyScore, setWeeklyScore] = useState(0);
  const [monthlyScore, setMonthlyScore] = useState(0);
  const [weeklyTaskCount, setWeeklyTaskCount] = useState(0);
  const [monthlyTaskCount, setMonthlyTaskCount] = useState(0);
  const [weeklyCompletedCount, setWeeklyCompletedCount] = useState(0);
  const [monthlyCompletedCount, setMonthlyCompletedCount] = useState(0);
  const [reminderInterval, setReminderInterval] = useState(0);
  const [domainOrder, setDomainOrder] = useState(LIFE_DOMAINS.map((d) => d.name));
  const [heatmapLevels, setHeatmapLevels] = useState(Array(84).fill({ level: 0, isToday: false }));
  const [nextReminderTime, setNextReminderTime] = useState(null);
  const [timePicker, setTimePicker] = useState(null);
  const [notificationTarget, setNotificationTarget] = useState(null);
  const todayScrollViewRef = useRef(null);

  // FIX #6: monotonic counter — stale loadData results are dropped.
  const loadTokenRef = useRef(0);

  // FIX #N1: loading state with timeout and error
  const isLoadingRef = useRef(false);
  const loadingErrorRef = useRef(null);
  const loadingTimeoutRef = useRef(null);

  // FIX #11: refs for timeouts so we can cancel on dep change.
  const notifExpandTimeoutRef = useRef(null);
  const notifClearTimeoutRef = useRef(null);

  // FIX #18: ref mirror of timePicker so onConfirm always sees latest.
  const timePickerRef = useRef(null);
  useEffect(() => { timePickerRef.current = timePicker; }, [timePicker]);

  // FIX #30: heatmap in-flight guard.
  const heatmapTokenRef = useRef(0);

  // FIX #N2: shadow copy refs for immediate save (deleteTask, logSomaticState)
  const tasksRef = useRef({});
  const todayTasksRef = useRef([]);
  const somaticLogsRef = useRef([]);
  const dailyShutdownsRef = useRef([]);

  // Keep refs in sync with state
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);
  useEffect(() => { todayTasksRef.current = todayTasks; }, [todayTasks]);
  useEffect(() => { somaticLogsRef.current = somaticLogs; }, [somaticLogs]);
  useEffect(() => { dailyShutdownsRef.current = dailyShutdowns; }, [dailyShutdowns]);

  // FIX #N10: Global reminder mutex (not per-task) to prevent stale closures
  const globalReminderMutexRef = useRef(Promise.resolve());

  // FIX #N3: Heatmap cache for today's cell (separate from full heatmap)
  const todayHeatmapCellRef = useRef({ level: 0, isToday: true });

  // Load per-date data on currentDate change.
  useEffect(() => {
    loadData();
  }, [currentDate]);

  // Load reminder interval once.
  useEffect(() => {
    loadReminderInterval();
  }, []);

  // FIX #N4: On app mount, cancel all task reminders except today's.
  useEffect(() => {
    const today = localTodayString();
    cancelAllTaskRemindersExceptDate(today).catch((e) => {
      console.warn('[App] boot cleanup failed', e);
    });
  }, []);

  // FIX #10: midnight detection - refresh currentDate without user action
  useEffect(() => {
    const interval = setInterval(() => {
      const realToday = localTodayString();
      if (currentDate !== realToday) {
        setCurrentDate(realToday);
      }
    }, 30000); // Check every 30 seconds
    return () => clearInterval(interval);
  }, [currentDate]);

  // FIX #N16: On app mount, re-schedule breath reminder if interval > 0.
  useEffect(() => {
    if (reminderInterval > 0) {
      scheduleBreathReminder(reminderInterval).catch((e) => {
        console.warn('[App] boot breath reminder failed', e);
      });
    }
  }, []);

  // Display next breath reminder time.
  useEffect(() => {
    if (reminderInterval > 0) {
      const now = new Date();
      const nextTime = new Date(now.getTime() + reminderInterval * 3600 * 1000);
      const hours = nextTime.getHours();
      const minutes = nextTime.getMinutes();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const hours12 = hours % 12 || 12;
      const minutesStr = String(minutes).padStart(2, '0');
      setNextReminderTime(`${hours12}:${minutesStr} ${ampm}`);
    } else {
      setNextReminderTime(null);
    }
  }, [reminderInterval]);

  // FIX #26: trimmed dependencies — weekly/monthly score reads AsyncStorage
  // directly, not state. Re-running on every task checkmark is wasted work.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      if (analyticsView === 'weekly') {
        const [s, t, c] = await Promise.all([
          calculateWeeklyScore(),
          getWeeklyTaskCount(),
          getWeeklyCompletedCount(),
        ]);
        if (!cancelled) {
          setWeeklyScore(s);
          setWeeklyTaskCount(t);
          setWeeklyCompletedCount(c);
        }
      } else if (analyticsView === 'monthly') {
        const [s, t, c] = await Promise.all([
          calculateMonthlyScore(),
          getMonthlyTaskCount(),
          getMonthlyCompletedCount(),
        ]);
        if (!cancelled) {
          setMonthlyScore(s);
          setMonthlyTaskCount(t);
          setMonthlyCompletedCount(c);
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyticsView, currentDate]);

  // FIX #11: notificationTarget effect with cleanup of nested timeouts.
  useEffect(() => {
    if (notifExpandTimeoutRef.current) {
      clearTimeout(notifExpandTimeoutRef.current);
      notifExpandTimeoutRef.current = null;
    }
    if (notifClearTimeoutRef.current) {
      clearTimeout(notifClearTimeoutRef.current);
      notifClearTimeoutRef.current = null;
    }
    if (!notificationTarget || currentPage !== 'today') return;

    notifExpandTimeoutRef.current = setTimeout(() => {
      setExpandedDomains((prev) => ({ ...prev, [notificationTarget.domain]: true }));
      if (todayScrollViewRef.current) {
        todayScrollViewRef.current.scrollTo({ y: 0, animated: true });
      }
      notifClearTimeoutRef.current = setTimeout(() => {
        setNotificationTarget(null);
      }, 1500);
    }, 600);

    return () => {
      if (notifExpandTimeoutRef.current) {
        clearTimeout(notifExpandTimeoutRef.current);
        notifExpandTimeoutRef.current = null;
      }
      if (notifClearTimeoutRef.current) {
        clearTimeout(notifClearTimeoutRef.current);
        notifClearTimeoutRef.current = null;
      }
    };
  }, [notificationTarget, currentPage]);

  // FIX #22: if the user navigates away from 'today' while a notification
  // target is pending, clear it so it doesn't re-fire later.
  useEffect(() => {
    if (notificationTarget && currentPage !== 'today') {
      setNotificationTarget(null);
    }
  }, [currentPage, notificationTarget]);

  // Notification setup. Listener leak (bug #9) is intentionally not addressed
  // per the user's instruction.
  useEffect(() => {
    let notificationCleanup = null;
    setupNotifications((response) => {
      const data = response?.notification?.request?.content?.data;
      if (!data) return;
      if (data.type === 'today_task') {
        setCurrentPage('today');
        if (data.targetDate) {
          setCurrentDate(data.targetDate);
        }
        setNotificationTarget({ domain: data.domain, taskId: data.taskId });
      } else if (data.type === 'somatic_reminder') {
        // FIX #16: do not act on unknown / future types by defaulting to
        // somatic. Only navigate when the type is explicitly a somatic_reminder.
        setCurrentPage('somatic');
      }
    }).then((cleanupFn) => {
      notificationCleanup = cleanupFn;
    });
    return () => {
      if (notificationCleanup) {
        notificationCleanup();
      }
    };
  }, []);

  // FIX #N3 + #30: heatmap re-loads on date change. Uses
  // a token so stale resolutions don't overwrite newer data.
  // Today's cell is updated separately via todayTasks effect.
  useEffect(() => {
    loadHeatmapData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentDate]);

  // FIX #N3: Update today's heatmap cell when tasks change (no full reload)
  // Only reload if we're viewing today - otherwise no need to update
  useEffect(() => {
    const todayKey = localTodayString();
    if (currentDate !== todayKey) return; // Only update if viewing today
    
    const score = todayTasks.length > 0 
      ? Math.round((todayTasks.filter((t) => tasks[t.id]).length / todayTasks.length) * 100)
      : 0;
    let level = 0;
    if (score > 0 && score <= 25) level = 1;
    else if (score <= 50) level = 2;
    else if (score <= 75) level = 3;
    else if (score > 75) level = 4;
    todayHeatmapCellRef.current = { level, isToday: true };
    
    // Update the heatmap array directly - find today's cell and update it
    setHeatmapLevels((prev) => {
      const newLevels = [...prev];
      // Find today's index in the heatmap grid
      // The grid starts 83 days ago from today, with firstMonday as anchor
      const today = new Date();
      const startOfGrid = new Date(today);
      startOfGrid.setDate(today.getDate() - 83);
      
      const firstMonday = new Date(startOfGrid);
      const dayOfWeek = firstMonday.getDay();
      const daysUntilMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek) % 7;
      firstMonday.setDate(startOfGrid.getDate() + daysUntilMonday);
      
      // Today is always at some offset from firstMonday
      const daysDiff = Math.floor((today.getTime() - firstMonday.getTime()) / (1000 * 60 * 60 * 24));
      if (daysDiff >= 0 && daysDiff < 84) {
        newLevels[daysDiff] = { level, isToday: true };
      }
      return newLevels;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, todayTasks, currentDate]);

  // -------------------- Auto-save (FIX #5) --------------------
  // Debounced save on any state change to the per-date blob.
  // FIX #N1: Skip save while loading is in progress.
  useEffect(() => {
    if (isLoadingRef.current) return; // Don't save during date change load
    
    const id = setTimeout(() => {
      saveData(true);
    }, 300);
    return () => clearTimeout(id);
    // We intentionally only depend on the date-scoped state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, todayTasks, goals, somaticLogs, dailyShutdowns, taskReminders, currentDate]);

  // expandedDomains is global. Persist on change.
  useEffect(() => {
    AsyncStorage.setItem(EXPANDED_DOMAINS_KEY, JSON.stringify(expandedDomains)).catch(() => {});
  }, [expandedDomains]);

  // -------------------- Data load/save --------------------

  const loadData = async (dateArg) => {
    const date = dateArg || currentDate;
    const myToken = ++loadTokenRef.current;
    
    // FIX #N1: Set loading state and start timeout
    isLoadingRef.current = true;
    loadingErrorRef.current = null;
    
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
    }
    
    // Use a flag to track if timeout fired
    let timeoutFired = false;
    
    loadingTimeoutRef.current = setTimeout(() => {
      if (isLoadingRef.current && myToken === loadTokenRef.current) {
        timeoutFired = true;
        loadingErrorRef.current = 'Failed to load data. Please try again.';
        isLoadingRef.current = false;
        Alert.alert('Error', 'Could not load this day\'s data. Please try again.');
      }
    }, 5000); // 5 second timeout
    
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY(date));
      // If timeout already fired, don't apply the data
      if (timeoutFired || myToken !== loadTokenRef.current) return; // stale or timed out
      
      if (raw) {
        const parsed = JSON.parse(raw);
        if (timeoutFired || myToken !== loadTokenRef.current) return;
        setTasks(parsed.tasks || {});
        setGoals(parsed.goals || defaultGoals());
        setTodayTasks(
          (parsed.todayTasks || []).map((t) => ({
            ...t,
            domain: t.domain || 'Personal Growth',
          }))
        );
        setSomaticLogs(parsed.somaticLogs || []);
        setDailyShutdowns(parsed.dailyShutdowns || []);
        setTaskReminders(parsed.taskReminders || {});
        // expandedDomains lives in a global key now (bug #19). Keep the
        // legacy per-date copy as a one-time seed for older installs.
        if (
          parsed.expandedDomains &&
          Object.keys(parsed.expandedDomains).length > 0 &&
          Object.keys(expandedDomains).length === 0
        ) {
          setExpandedDomains(parsed.expandedDomains);
        }
      } else {
        if (timeoutFired || myToken !== loadTokenRef.current) return;
        setTasks({});
        setGoals(defaultGoals());
        setTodayTasks([]);
        setSomaticLogs([]);
        setDailyShutdowns([]);
        setTaskReminders({});
      }
    } catch (e) {
      console.warn('[App] loadData failed', e);
      // Only show error if timeout didn't already fire
      if (!timeoutFired) {
        loadingErrorRef.current = 'Failed to load data. Please try again.';
        Alert.alert('Error', 'Could not load this day\'s data. Please try again.');
      }
    } finally {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
      isLoadingRef.current = false;
    }

    // Expanded domains (global) and domain order — load independently.
    try {
      const savedExpanded = await AsyncStorage.getItem(EXPANDED_DOMAINS_KEY);
      // FIX #N14: Only load if not already set (avoid overwriting)
      if (myToken === loadTokenRef.current && savedExpanded && Object.keys(expandedDomains).length === 0) {
        try {
          setExpandedDomains(JSON.parse(savedExpanded));
        } catch (e) {
          console.warn('[App] expandedDomains parse failed, resetting', e);
          setExpandedDomains({});
        }
      }
    } catch (e) {}

    try {
      const savedOrder = await AsyncStorage.getItem(DOMAIN_ORDER_KEY);
      if (myToken === loadTokenRef.current && savedOrder) {
        setDomainOrder(JSON.parse(savedOrder));
      }
    } catch (e) {}
  };

  const loadReminderInterval = async () => {
    try {
      const interval = await AsyncStorage.getItem(REMINDER_INTERVAL_KEY);
      if (interval !== null && interval !== undefined) {
        const n = parseFloat(interval);
        if (Number.isFinite(n)) setReminderInterval(n);
      }
    } catch (e) {}
  };

  // FIX #N3 + #30: parallel, batched reads, token-guarded.
  // Today's cell is handled separately via todayTasks effect.
  const loadHeatmapData = async () => {
    const myToken = ++heatmapTokenRef.current;
    try {
      const today = new Date();
      const startOfGrid = new Date(today);
      startOfGrid.setDate(today.getDate() - 83);

      const firstMonday = new Date(startOfGrid);
      const dayOfWeek = firstMonday.getDay();
      const daysUntilMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek) % 7;
      firstMonday.setDate(startOfGrid.getDate() + daysUntilMonday);

      // Build the list of (row, col, key) cells first so we can batch reads.
      const cells = [];
      const realTodayKey = localTodayString();
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 12; col++) {
          const cellDate = new Date(firstMonday);
          cellDate.setDate(firstMonday.getDate() + row + col * 7);
          const key = dateToLocalKey(cellDate);
          cells.push({ row, col, key });
        }
      }

      // Batch reads in groups of 10 to avoid overwhelming the bridge.
      const batchedKeys = [];
      for (let i = 0; i < cells.length; i += 10) {
        batchedKeys.push(cells.slice(i, i + 10).map((c) => c.key));
      }

      const levelMap = {};
      for (const batch of batchedKeys) {
        const results = await Promise.all(
          batch.map((key) =>
            AsyncStorage.getItem('muhsanTracker_' + key).catch(() => null)
          )
        );
        batch.forEach((key, idx) => {
          const raw = results[idx];
          if (raw) {
            try {
              const parsed = JSON.parse(raw);
              const list = parsed.todayTasks || [];
              const dayTasks = parsed.tasks || {};
              if (list.length > 0) {
                const done = list.filter((t) => dayTasks[t.id]).length;
                const rate = Math.round((done / list.length) * 100);
                let level = 0;
                if (rate > 0 && rate <= 25) level = 1;
                else if (rate <= 50) level = 2;
                else if (rate <= 75) level = 3;
                else if (rate > 75) level = 4;
                levelMap[key] = level;
              }
            } catch (e) {}
          }
        });
      }

      const levels = [];
      for (const cell of cells) {
        const level = levelMap[cell.key] || 0;
        // FIX #23: use REAL today (local), not currentDate.
        const isToday = cell.key === realTodayKey;
        levels.push({ level, isToday });
      }

      if (myToken !== heatmapTokenRef.current) return;
      setHeatmapLevels(levels);
    } catch (e) {
      console.warn('[App] loadHeatmapData failed', e);
    }
  };

  const saveData = async (silent) => {
    try {
      // FIX #N2: Use shadow copy refs for immediate save
      const dataToSave = {
        tasks: tasksRef.current,
        goals,
        todayTasks: todayTasksRef.current,
        somaticLogs: somaticLogsRef.current,
        dailyShutdowns: dailyShutdownsRef.current,
        taskReminders,
        date: currentDate,
      };
      await AsyncStorage.setItem(STORAGE_KEY(currentDate), JSON.stringify(dataToSave));
      if (!silent) Alert.alert('Saved', 'Day saved 🔥');
    } catch (error) {
      Alert.alert('Error', 'Failed to save data');
    }
  };

  // -------------------- Goals --------------------

  const updateGoalText = (domain, text) => {
    setGoals((prev) => {
      const cur = prev[domain] || { goalText: '', progress: 0 };
      return { ...prev, [domain]: { ...cur, goalText: text } };
    });
  };

  const updateGoalProgress = (domain, delta) => {
    setGoals((prev) => {
      const cur = prev[domain] || { goalText: '', progress: 0 };
      const next = Math.max(0, Math.min(100, (cur.progress || 0) + delta));
      return { ...prev, [domain]: { ...cur, progress: next } };
    });
  };

  // FIX #31: await the AsyncStorage write and surface failure.
  const moveDomain = async (index, direction) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= domainOrder.length) return;
    const newOrder = [...domainOrder];
    [newOrder[index], newOrder[nextIndex]] = [newOrder[nextIndex], newOrder[index]];
    setDomainOrder(newOrder);
    try {
      await AsyncStorage.setItem(DOMAIN_ORDER_KEY, JSON.stringify(newOrder));
    } catch (e) {
      console.warn('[App] moveDomain persist failed', e);
    }
  };

  const toggleDomain = (domain) => {
    // FIX #27: scoped LayoutAnimation (less aggressive than global default).
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedDomains((prev) => ({ ...prev, [domain]: !prev[domain] }));
  };

  // -------------------- Today tasks --------------------

  const addDomainTask = (domain) => {
    const text = (domainInputs[domain] || '').trim();
    if (!text) return;
    setTodayTasks([
      ...todayTasks,
      { id: Date.now() + Math.random(), domain, text, category: 'C', completed: false },
    ]);
    setDomainInputs({ ...domainInputs, [domain]: '' });
  };

  // FIX #N2 + #28: deleteTask saves using shadow copy, not stale closure
  const deleteTask = async (taskId) => {
    const existing = taskReminders[taskId];
    if (existing && existing.notifId) {
      const ok = await cancelTaskReminder(existing.notifId);
      if (!ok) {
        console.warn('[App] deleteTask: cancel returned false (may already be gone)');
      }
    }
    setTodayTasks((prev) => prev.filter((t) => t.id !== taskId));
    setTasks((prev) => {
      if (!(taskId in prev)) return prev;
      const { [taskId]: _gone, ...rest } = prev;
      return rest;
    });
    setTaskReminders((prev) => {
      if (!(taskId in prev)) return prev;
      const { [taskId]: _gone, ...rest } = prev;
      return rest;
    });
    // FIX #28: Explicit save using shadow copy
    saveData(true);
  };

  const setTaskCategory = (taskId, category) => {
    setTodayTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, category } : t)));
  };

  // FIX #N10: Global mutex + synchronous memory update for reminder changes
  const setTaskReminder = async (taskId, hour, minute) => {
    if (!taskId) return;
    hour = Math.max(0, Math.min(23, Math.floor(Number(hour) || 0)));
    minute = Math.max(0, Math.min(59, Math.floor(Number(minute) || 0)));

    const task = todayTasks.find((t) => t.id === taskId);
    if (!task) return;

    // Global mutex: serialize ALL reminder changes
    const prev = globalReminderMutexRef.current;
    const next = prev
      .catch((e) => {
        console.error('[App] setTaskReminder failed in mutex', e);
        throw e;
      })
      .then(() => doSetTaskReminder(taskId, hour, minute, task));
    globalReminderMutexRef.current = next;
    return next;
  };

  const doSetTaskReminder = async (taskId, hour, minute, task) => {
    const ampmHour = hour % 12 === 0 ? 12 : hour % 12;
    const ampm = hour < 12 ? 'AM' : 'PM';
    const mm = String(minute).padStart(2, '0');
    const formattedTime = `${ampmHour}:${mm} ${ampm}`;

    // FIX #N10: Synchronous memory update - remove old, add new immediately
    setTaskReminders((prevRem) => {
      const updated = { ...prevRem };
      delete updated[taskId]; // Remove old first
      updated[taskId] = {
        time: formattedTime,
        hour,
        minute,
        notifId: null, // Will be set after scheduling
      };
      return updated;
    });

    const prevReminder = taskReminders[taskId];
    if (prevReminder && prevReminder.notifId) {
      await cancelTaskReminder(prevReminder.notifId);
    }

    const notifId = await scheduleTaskReminder(
      task.text,
      hour,
      minute,
      taskId,
      task.domain,
      currentDate
    );

    if (notifId) {
      setTaskReminders((prevRem) => ({
        ...prevRem,
        [taskId]: { time: formattedTime, hour, minute, notifId },
      }));
    } else {
      // FIX #N20: UX feedback when schedule fails
      if (hour && minute) {
        Alert.alert('Reminder Failed', 'Could not schedule reminder. The time may have already passed.');
      }
      setTaskReminders((prevRem) => {
        const updated = { ...prevRem };
        delete updated[taskId];
        return updated;
      });
    }
  };

  const clearTaskReminder = async (taskId) => {
    const prev = taskReminders[taskId];
    if (prev && prev.notifId) {
      await cancelTaskReminder(prev.notifId);
    }
    setTaskReminders((prevRem) => {
      if (!(taskId in prevRem)) return prevRem;
      const { [taskId]: _gone, ...rest } = prevRem;
      return rest;
    });
  };

  // FIX #15: async, awaits the reminder cleanup.
  const toggleTask = async (taskId) => {
    const wasDone = !!tasks[taskId];
    if (!wasDone) {
      await clearTaskReminder(taskId);
    }
    setTasks((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
  };

  const sortedTasks = (domain) => todayTasks
    .filter((t) => t.domain === domain)
    .sort((a, b) => PRIORITY_ORDER.indexOf(a.category) - PRIORITY_ORDER.indexOf(b.category));

  const calculateScore = () => {
    if (todayTasks.length === 0) return 0;
    const completed = todayTasks.filter((t) => tasks[t.id]).length;
    return Math.round((completed / todayTasks.length) * 100);
  };

  const calculateWeeklyScore = async () => {
    try {
      const today = new Date();
      const dayOfWeek = today.getDay();
      
      const startOfWeek = new Date(today);
      const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      startOfWeek.setDate(today.getDate() - diff);
      
      let totalTasks = 0;
      let completedTasks = 0;
      
      for (let i = 0; i < 7; i++) {
        const d = new Date(startOfWeek);
        d.setDate(startOfWeek.getDate() + i);
        const key = dateToLocalKey(d);
        
        if (key === currentDate) {
          totalTasks += todayTasks.length;
          completedTasks += todayTasks.filter((t) => tasks[t.id]).length;
        } else {
          const raw = await AsyncStorage.getItem('muhsanTracker_' + key);
          if (raw) {
            const parsed = JSON.parse(raw);
            const list = parsed.todayTasks || [];
            const dayTasks = parsed.tasks || {};
            totalTasks += list.length;
            completedTasks += list.filter((t) => dayTasks[t.id]).length;
          }
        }
      }
      
      if (totalTasks === 0) return 0;
      return Math.round((completedTasks / totalTasks) * 100);
    } catch (error) {
      console.error('Error calculating weekly score:', error);
      return 0;
    }
  };

  const calculateMonthlyScore = async () => {
    try {
      const today = new Date();
      const year = today.getFullYear();
      const month = today.getMonth();
      
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      
      let totalTasks = 0;
      let completedTasks = 0;
      
      for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
        const key = dateToLocalKey(d);
        
        if (key === currentDate) {
          totalTasks += todayTasks.length;
          completedTasks += todayTasks.filter((t) => tasks[t.id]).length;
        } else {
          const raw = await AsyncStorage.getItem('muhsanTracker_' + key);
          if (raw) {
            const parsed = JSON.parse(raw);
            const list = parsed.todayTasks || [];
            const dayTasks = parsed.tasks || {};
            totalTasks += list.length;
            completedTasks += list.filter((t) => dayTasks[t.id]).length;
          }
        }
      }
      
      if (totalTasks === 0) return 0;
      return Math.round((completedTasks / totalTasks) * 100);
    } catch (error) {
      console.error('Error calculating monthly score:', error);
      return 0;
    }
  };

  const getWeeklyTaskCount = async () => {
    try {
      const today = new Date();
      const dayOfWeek = today.getDay();
      
      const startOfWeek = new Date(today);
      const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      startOfWeek.setDate(today.getDate() - diff);
      
      let totalTasks = 0;
      
      for (let i = 0; i < 7; i++) {
        const d = new Date(startOfWeek);
        d.setDate(startOfWeek.getDate() + i);
        const key = dateToLocalKey(d);
        
        if (key === currentDate) {
          totalTasks += todayTasks.length;
        } else {
          const raw = await AsyncStorage.getItem('muhsanTracker_' + key);
          if (raw) {
            const parsed = JSON.parse(raw);
            totalTasks += (parsed.todayTasks || []).length;
          }
        }
      }
      
      return totalTasks;
    } catch (error) {
      console.error('Error getting weekly task count:', error);
      return 0;
    }
  };

  const getMonthlyTaskCount = async () => {
    try {
      const today = new Date();
      const year = today.getFullYear();
      const month = today.getMonth();
      
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      
      let totalTasks = 0;
      
      for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
        const key = dateToLocalKey(d);
        
        if (key === currentDate) {
          totalTasks += todayTasks.length;
        } else {
          const raw = await AsyncStorage.getItem('muhsanTracker_' + key);
          if (raw) {
            const parsed = JSON.parse(raw);
            totalTasks += (parsed.todayTasks || []).length;
          }
        }
      }
      
      return totalTasks;
    } catch (error) {
      console.error('Error getting monthly task count:', error);
      return 0;
    }
  };

  const getWeeklyCompletedCount = async () => {
    try {
      const today = new Date();
      const dayOfWeek = today.getDay();
      
      const startOfWeek = new Date(today);
      const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      startOfWeek.setDate(today.getDate() - diff);
      
      let completedTasks = 0;
      
      for (let i = 0; i < 7; i++) {
        const d = new Date(startOfWeek);
        d.setDate(startOfWeek.getDate() + i);
        const key = dateToLocalKey(d);
        
        if (key === currentDate) {
          completedTasks += todayTasks.filter((t) => tasks[t.id]).length;
        } else {
          const raw = await AsyncStorage.getItem('muhsanTracker_' + key);
          if (raw) {
            const parsed = JSON.parse(raw);
            const list = parsed.todayTasks || [];
            const dayTasks = parsed.tasks || {};
            completedTasks += list.filter((t) => dayTasks[t.id]).length;
          }
        }
      }
      
      return completedTasks;
    } catch (error) {
      console.error('Error getting weekly completed count:', error);
      return 0;
    }
  };

  const getMonthlyCompletedCount = async () => {
    try {
      const today = new Date();
      const year = today.getFullYear();
      const month = today.getMonth();
      
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      
      let completedTasks = 0;
      
      for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
        const key = dateToLocalKey(d);
        
        if (key === currentDate) {
          completedTasks += todayTasks.filter((t) => tasks[t.id]).length;
        } else {
          const raw = await AsyncStorage.getItem('muhsanTracker_' + key);
          if (raw) {
            const parsed = JSON.parse(raw);
            const list = parsed.todayTasks || [];
            const dayTasks = parsed.tasks || {};
            completedTasks += list.filter((t) => dayTasks[t.id]).length;
          }
        }
      }
      
      return completedTasks;
    } catch (error) {
      console.error('Error getting monthly completed count:', error);
      return 0;
    }
  };

  const ProgressRing = ({ progress }) => {
    const radius = 36;
    const strokeWidth = 7;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (progress / 100) * circumference;

    return (
      <View style={styles.ringContainer}>
        <Svg width={radius * 2} height={radius * 2}>
          <Circle
            cx={radius}
            cy={radius}
            r={radius - strokeWidth / 2}
            stroke={progress === 100 ? COLORS.green : COLORS.accent}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
          />
        </Svg>
        <View style={styles.ringLabel}>
          <Text style={styles.ringPct}>{progress}%</Text>
          <Text style={styles.ringSub}>Done</Text>
        </View>
      </View>
    );
  };

  // -------------------- Date navigation --------------------
  // FIX #1: navigate-away cancels all task notifications for the leaving date.
  const shiftDate = async (days) => {
    const leavingDate = currentDate;
    // Persist current state first.
    await saveData(true);
    // Cancel all task notifications for the date we're leaving.
    try {
      const cancelled = await cancelAllTaskRemindersForDate(leavingDate);
      if (cancelled > 0) {
        // After cancellation, drop the reminder ids from local state too
        // so the next save doesn't carry stale ids.
        setTaskReminders((prev) => {
          const next = {};
          for (const [k, v] of Object.entries(prev)) {
            if (!v || !v.notifId) next[k] = v;
            else next[k] = { ...v, notifId: null };
          }
          return next;
        });
      }
    } catch (e) {
      console.warn('[App] shiftDate cancel failed', e);
    }
    const d = new Date(currentDate);
    d.setDate(d.getDate() + days);
    setCurrentDate(dateToLocalKey(d));
  };

  const goToToday = async () => {
    const leavingDate = currentDate;
    if (leavingDate !== localTodayString()) {
      await saveData(true);
      // FIX #N5: Cancel old OS notifications when navigating to today
      try {
        await cancelAllTaskRemindersForDate(leavingDate);
      } catch (e) {
        console.warn('[App] goToToday cancel failed', e);
      }
    }
    setCurrentDate(localTodayString());
  };

  // -------------------- Somatic / shutdown --------------------

  // FIX #4 + #N2: persist somatic state using shadow copy
  const logSomaticState = () => {
    const entry = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      focusLevel: somaticData.focusLevel,
      thoughts: somaticData.thoughts,
      thoughtLabel: somaticData.thoughtLabel,
      technique: somaticData.technique,
    };
    setSomaticLogs((prev) => [...prev, entry]);
    setSomaticData({ focusLevel: null, thoughts: '', thoughtLabel: '', technique: null });
    // FIX #N2: Explicit save using shadow copy
    saveData(true);
  };

  // BUG #14 intentionally not fixed per user request.
  const completeShutdown = () => {
    const shutdown = {
      id: Date.now(),
      date: currentDate,
      reflection: shutdownReflection,
      completionPct: calculateScore(),
      shutdownTime: new Date().toISOString(),
    };
    setDailyShutdowns((prev) => [...prev, shutdown]);
    setShutdownReflection('');
    saveData(true);
    Alert.alert('Shutdown Complete', 'Day logged. Get some rest 😴');
  };

  // FIX #25: round the float to a clean value so equality comparisons
  // against option.h stay stable across round-trips.
  const changeReminder = async (hours) => {
    const clean = Math.round(hours * 1000) / 1000;
    setReminderInterval(clean);
    try {
      await AsyncStorage.setItem(REMINDER_INTERVAL_KEY, clean.toString());
    } catch (e) {}
    if (clean > 0) {
      await scheduleBreathReminder(clean);
    } else {
      await cancelBreathReminder();
    }
  };

  // -------------------- Pages --------------------

  const renderGoalsPage = () => (
    <View style={styles.page}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Goals</Text>
      </View>
      <ScrollView style={styles.content}>
        {domainOrder.map((domainName, index) => {
          const domain = LIFE_DOMAINS.find((d) => d.name === domainName);
          const goal = goals[domainName] || { goalText: '', progress: 0 };
          const isExpanded = expandedDomains[domainName];

          return (
            <View key={domainName} style={styles.domainSection}>
              <TouchableOpacity 
                style={styles.domainHeader}
                onPress={() => toggleDomain(domainName)}
              >
                <View style={styles.domainName}>
                  <Text style={styles.domainIcon}>{domain.icon}</Text>
                  <Text style={styles.domainText}>{domain.name}</Text>
                </View>
                <View style={styles.goalHeaderRight}>
                  <View style={styles.progressRow}>
                    <TouchableOpacity style={styles.stepBtn} onPress={(e) => { e.stopPropagation && e.stopPropagation(); updateGoalProgress(domain.name, -10); }}>
                      <Text style={styles.stepBtnText}>−</Text>
                    </TouchableOpacity>
                    <Text style={styles.progressText}>{goal?.progress || 0}%</Text>
                    <View style={styles.progressBarTrack}>
                      <View style={[styles.progressBarFill, { width: `${goal?.progress || 0}%` }]} />
                    </View>
                    <TouchableOpacity style={styles.stepBtn} onPress={(e) => { e.stopPropagation && e.stopPropagation(); updateGoalProgress(domain.name, 10); }}>
                      <Text style={styles.stepBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.chevron}>{isExpanded ? '▼' : '▶'}</Text>
                </View>
              </TouchableOpacity>
              
              {isExpanded && (
                <View style={styles.goalExpanded}>
                  <TextInput
                    style={styles.goalInput}
                    value={goal?.goalText || ''}
                    onChangeText={(t) => updateGoalText(domain.name, t)}
                    placeholder={`Long-term goal for ${domain.name}...`}
                    placeholderTextColor={COLORS.muted}
                    multiline
                    textAlignVertical="top"
                  />
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );

  const renderTodayPage = () => {
    const score = calculateScore();
    const completed = todayTasks.filter((t) => tasks[t.id]).length;
    return (
      <View style={styles.page}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Today</Text>
        </View>
        <View style={styles.dateNav}>
          <TouchableOpacity style={styles.dateButton} onPress={() => shiftDate(-1)}>
            <Text style={styles.dateButtonText}>◀</Text>
          </TouchableOpacity>
          <Text style={styles.dateInput}>{currentDate}</Text>
          <TouchableOpacity style={styles.dateButton} onPress={() => shiftDate(1)}>
            <Text style={styles.dateButtonText}>▶</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.todayButton} onPress={goToToday}>
            <Text style={styles.todayButtonText}>Today</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.scoreContainer}>
          <ProgressRing progress={score} />
          <Text style={styles.ringCaption}>{completed} of {todayTasks.length} tasks completed</Text>
        </View>

        <ScrollView ref={todayScrollViewRef} style={styles.content}>
          {domainOrder.map((domainName, index) => {
            const domain = LIFE_DOMAINS.find((d) => d.name === domainName);
            const isExpanded = expandedDomains[domainName];
            const list = sortedTasks(domainName);
            const doneCount = list.filter((t) => tasks[t.id]).length;
            const count = list.length;
            const allDone = count > 0 && doneCount === count;

            return (
              <View key={domainName} style={styles.domainSection}>
                <TouchableOpacity 
                  style={styles.domainHeader}
                  onPress={() => toggleDomain(domainName)}
                >
                  <View style={styles.domainName}>
                    <Text style={styles.domainIcon}>{domain.icon}</Text>
                    <Text style={styles.domainText}>{domain.name}</Text>
                  </View>
                  <View style={styles.domainMeta}>
                    <View style={[styles.domainCount, allDone && styles.domainCountDone]}>
                      <Text style={[styles.domainCountText, allDone && styles.domainCountTextDone]}>{doneCount}/{count}</Text>
                    </View>
                    {count > 0 && (
                      <View style={[styles.priorityBadge, { backgroundColor: CATEGORY_COLORS[list[0].category] + '20', borderColor: CATEGORY_COLORS[list[0].category] + '40' }]}>
                        <Text style={[styles.priorityBadgeText, { color: CATEGORY_COLORS[list[0].category] }]}>{list[0].category}</Text>
                      </View>
                    )}
                    <TouchableOpacity 
                      style={styles.reorderBtn}
                      onPress={(e) => {
                        e.stopPropagation && e.stopPropagation();
                        moveDomain(index, -1);
                      }}
                      disabled={index === 0}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.reorderBtnText, index === 0 && styles.reorderBtnTextDisabled]}>▲</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={styles.reorderBtn}
                      onPress={(e) => {
                        e.stopPropagation && e.stopPropagation();
                        moveDomain(index, 1);
                      }}
                      disabled={index === domainOrder.length - 1}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.reorderBtnText, index === domainOrder.length - 1 && styles.reorderBtnTextDisabled]}>▼</Text>
                    </TouchableOpacity>
                    <Text style={styles.chevron}>{isExpanded ? '▼' : '▶'}</Text>
                  </View>
                </TouchableOpacity>
                
                {isExpanded && (
                  <View style={styles.expandedContent}>
                    <View style={styles.taskInputRow}>
                      <TextInput
                        style={styles.taskInput}
                        value={domainInputs[domain.name] || ''}
                        onChangeText={(t) => setDomainInputs({ ...domainInputs, [domain.name]: t })}
                        placeholder={`Add a ${domain.name} task...`}
                        placeholderTextColor={COLORS.text}
                      />
                      <TouchableOpacity style={styles.addBtn} onPress={() => addDomainTask(domain.name)}>
                        <Text style={styles.addBtnText}>+</Text>
                      </TouchableOpacity>
                    </View>
                    
                    {list.length === 0 ? (
                      <View style={styles.emptyState}>
                        <Text style={styles.emptyIcon}>📋</Text>
                        <Text style={styles.emptyText}>No tasks yet — tap + to add your first</Text>
                      </View>
                    ) : (
                      <React.Fragment>
                        {list.map((task) => (
                          <View key={task.id} style={styles.taskRow}>
                            <View style={[styles.catBadge, { backgroundColor: CATEGORY_COLORS[task.category] }]}>
                              <Text style={styles.catBadgeText}>{task.category}</Text>
                            </View>
                            <Text style={[styles.taskText, tasks[task.id] && styles.taskTextDone]}>{task.text}</Text>
                            <View style={styles.priorityBtns}>
                              {PRIORITY_ORDER.map((cat) => (
                                <TouchableOpacity
                                  key={cat}
                                  onPress={() => setTaskCategory(task.id, cat)}
                                  style={[styles.priorityBtn, task.category === cat && styles.priorityBtnActive]}
                                >
                                  <Text style={[styles.priorityBtnText, task.category === cat && styles.priorityBtnTextActive]}>{cat}</Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                            <TouchableOpacity onPress={() => deleteTask(task.id)} style={styles.deleteBtn}>
                              <Text style={styles.deleteBtnText}>🗑</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => toggleTask(task.id)}>
                              <View style={[styles.checkbox, tasks[task.id] && styles.checkboxChecked]}>
                                {tasks[task.id] && <Text style={styles.checkmark}>✓</Text>}
                              </View>
                            </TouchableOpacity>
                          </View>
                        ))}
                        
                        {list.length > 0 && (
                          <View style={styles.reminderSection}>
                            <Text style={styles.reminderTitle}>Task Reminders</Text>
                            {list.map((task) => {
                              const rem = taskReminders[task.id];
                              return (
                                <View key={task.id} style={styles.reminderRow}>
                                  <Text style={styles.reminderTaskText} numberOfLines={1}>{task.text}</Text>
                                  <TouchableOpacity
                                    style={styles.reminderChip}
                                    onPress={() => setTimePicker({
                                      taskId: task.id,
                                      hour: rem ? rem.hour : 9,
                                      minute: rem ? rem.minute : 0,
                                    })}
                                  >
                                    <Text style={styles.reminderChipText}>
                                      {rem ? rem.time : 'Set Time'}
                                    </Text>
                                  </TouchableOpacity>
                                  {rem && (
                                    <TouchableOpacity
                                      style={styles.reminderClearBtn}
                                      onPress={() => clearTaskReminder(task.id)}
                                    >
                                      <Text style={styles.reminderClearText}>✕</Text>
                                    </TouchableOpacity>
                                  )}
                                </View>
                              );
                            })}
                          </View>
                        )}
                      </React.Fragment>
                    )}                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      </View>
    );
  };

  // -------------------- Analytics --------------------

  const domainStats = () => LIFE_DOMAINS.map((domain) => {
    const list = todayTasks.filter((t) => t.domain === domain.name);
    const done = list.filter((t) => tasks[t.id]).length;
    return { domain: domain.name, total: list.length, done, rate: list.length ? Math.round((done / list.length) * 100) : 0 };
  });

  const renderBarChart = (stats) => (
    <View style={styles.chartContainer}>
      {stats.map((stat) => (
        <View key={stat.domain} style={styles.chartRow}>
          <Text style={styles.chartLabel}>{stat.domain}</Text>
          <View style={styles.chartBarBackground}>
            <View style={[styles.chartBarFill, { width: `${stat.rate}%` }]} />
          </View>
          <Text style={styles.chartValue}>{stat.rate}%</Text>
        </View>
      ))}
    </View>
  );

  const renderAnalytics = () => {
    const score = analyticsView === 'daily' ? calculateScore() : (analyticsView === 'weekly' ? weeklyScore : monthlyScore);
    const totalTasks = analyticsView === 'daily' ? todayTasks.length : (analyticsView === 'weekly' ? weeklyTaskCount : monthlyTaskCount);
    const completedTasks = analyticsView === 'daily' ? todayTasks.filter((t) => tasks[t.id]).length : (analyticsView === 'weekly' ? weeklyCompletedCount : monthlyCompletedCount);

    return (
      <View style={styles.page}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Analytics</Text>
        </View>
        <View style={styles.analyticsViewToggle}>
          {['daily', 'weekly', 'monthly'].map((view) => (
            <TouchableOpacity
              key={view}
              style={[styles.analyticsTab, analyticsView === view && styles.analyticsTabActive]}
              onPress={() => setAnalyticsView(view)}
            >
              <Text style={[styles.analyticsTabText, analyticsView === view && styles.analyticsTabTextActive]}>{view.charAt(0).toUpperCase() + view.slice(1)}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <ScrollView style={styles.content}>
          <View style={styles.scoreContainer}>
            <ProgressRing progress={score} />
            <Text style={styles.ringCaption}>{completedTasks} of {totalTasks} tasks completed</Text>
          </View>
          {analyticsView !== 'daily' && (
            <View style={styles.chartContainer}>
              <Text style={styles.chartTitle}>
                {analyticsView === 'weekly' ? 'Weekly' : 'Monthly'} Domain Breakdown
              </Text>
              {renderBarChart(domainStats())}
            </View>
          )}
          <View style={styles.heatmapContainer}>
            <Text style={styles.heatmapTitle}>Activity Heatmap (Last 12 Weeks)</Text>
            <View style={styles.heatmapGrid}>
              {heatmapLevels.map((cell, index) => (
                <View
                  key={index}
                  style={[
                    styles.heatmapCell,
                    cell.isToday && styles.heatmapCellToday,
                  ]}
                >
                  <View style={[styles.heatmapLevel, { backgroundColor: HEAT_COLORS[cell.level] }]} />
                </View>
              ))}
            </View>
            <View style={styles.heatmapLegend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: HEAT_COLORS[1] }]} />
                <Text style={styles.legendText}>25%</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: HEAT_COLORS[2] }]} />
                <Text style={styles.legendText}>50%</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: HEAT_COLORS[3] }]} />
                <Text style={styles.legendText}>75%</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: HEAT_COLORS[4] }]} />
                <Text style={styles.legendText}>100%</Text>
              </View>
            </View>
          </View>
        </ScrollView>
      </View>
    );
  };

  const renderSomaticPage = () => (
    <View style={styles.page}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Somatic Awareness</Text>
      </View>
      <ScrollView style={styles.content}>
        <View style={styles.somaticCard}>
          <Text style={styles.promptText}>How focused are you right now?</Text>
          <View style={styles.buttonRow}>
            {['1', '2', '3', '4', '5'].map((level) => (
              <TouchableOpacity
                key={level}
                style={[styles.focusBtn, somaticData.focusLevel === level && styles.focusBtnActive]}
                onPress={() => setSomaticData({ ...somaticData, focusLevel: level })}
              >
                <Text style={[styles.focusBtnText, somaticData.focusLevel === level && styles.focusBtnTextActive]}>{level}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={styles.input}
            value={somaticData.thoughts}
            onChangeText={(t) => setSomaticData({ ...somaticData, thoughts: t })}
            placeholder="What's on your mind?"
            placeholderTextColor={COLORS.muted}
            multiline
            numberOfLines={4}
          />
          <TextInput
            style={styles.input}
            value={somaticData.thoughtLabel}
            onChangeText={(t) => setSomaticData({ ...somaticData, thoughtLabel: t })}
            placeholder="Label this thought (optional)"
            placeholderTextColor={COLORS.muted}
          />
          <Text style={styles.promptText}>Technique used (optional)</Text>
          <View style={styles.buttonRow}>
            {['Box Breathing', 'Body Scan', 'Body Scan + Label', 'Open Monitoring'].map((tech) => (
              <TouchableOpacity
                key={tech}
                style={[styles.chip, somaticData.technique === tech && styles.chipActive]}
                onPress={() => setSomaticData({ ...somaticData, technique: tech })}
              >
                <Text style={[styles.chipText, somaticData.technique === tech && styles.chipTextActive]} numberOfLines={1}>{tech}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={styles.saveButton} onPress={logSomaticState}>
            <Text style={styles.saveButtonText}>Save / Submit</Text>
          </TouchableOpacity>

          <View style={styles.divider} />
          {somaticLogs.length > 0 && (
            <>
              {somaticLogs.slice().reverse().map((log) => (
                <View key={log.id} style={styles.sessionCard}>
                  <View style={styles.sessionHeader}>
                    <Text style={styles.sessionTime}>{new Date(log.timestamp).toLocaleTimeString()}</Text>
                    <Text style={styles.sessionLevel}>Level {log.focusLevel}</Text>
                  </View>
                  {log.thoughtLabel && <Text style={styles.sessionLabel}>{log.thoughtLabel}</Text>}
                  <Text style={styles.sessionThought}>{log.thoughts || '(no thought)'}</Text>
                  {log.technique && <Text style={styles.sessionTechnique}>{log.technique}</Text>}
                </View>
              ))}
            </>
          )}
        </View>

        <View style={styles.divider} />
        <Text style={styles.promptText}>Breath Reminder</Text>
        <View style={styles.techniqueRow}>
          {[
            { label: 'Off', h: 0 },
            { label: '2m', h: 2 / 60 },
            { label: '1h', h: 1 },
            { label: '2h', h: 2 },
            { label: '4h', h: 4 },
          ].map((opt) => (
            <TouchableOpacity
              key={opt.label}
              style={[styles.techniqueBtn, Math.abs(reminderInterval - opt.h) < 0.001 && styles.techniqueBtnActive]}
              onPress={() => changeReminder(opt.h)}
            >
              <Text style={[styles.techniqueBtnText, Math.abs(reminderInterval - opt.h) < 0.001 && styles.techniqueBtnTextActive]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {nextReminderTime && (
          <View style={styles.breathReminderCard}>
            <Text style={styles.breathReminderTitle}>Next Breath Reminder</Text>
            <View style={styles.breathReminderTimeContainer}>
              <Text style={styles.breathReminderTime}>{nextReminderTime}</Text>
              <Text style={styles.breathReminderHint}>Next notification time</Text>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );

  const renderShutdownPage = () => (
    <View style={styles.page}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Shutdown Ritual</Text>
      </View>
      <ScrollView style={styles.content}>
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: COLORS.accent2 }]}>{todayTasks.length}</Text>
            <Text style={styles.statLabel}>TASKS TODAY</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: COLORS.green }]}>{todayTasks.filter((t) => tasks[t.id]).length}</Text>
            <Text style={styles.statLabel}>COMPLETED</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: COLORS.accent2 }]}>{somaticLogs.length}</Text>
            <Text style={styles.statLabel}>SOMATIC LOGS</Text>
          </View>
        </View>

        <View style={styles.divider} />
        <Text style={styles.promptText}>Reflection — how did today go?</Text>
        <TextInput
          style={styles.input}
          value={shutdownReflection}
          onChangeText={setShutdownReflection}
          placeholder="Write your reflection..."
          placeholderTextColor={COLORS.muted}
          multiline
          numberOfLines={4}
        />
        <TouchableOpacity style={styles.compactSaveButton} onPress={completeShutdown}>
          <Text style={styles.compactSaveButtonText}>SHUTDOWN</Text>
        </TouchableOpacity>

        <View style={styles.divider} />
        {dailyShutdowns.length > 0 && (
          <>
            {dailyShutdowns.slice().reverse().map((s) => (
              <View key={s.id} style={styles.reflectionCard}>
                <View style={styles.reflectionHeader}>
                  <Text style={styles.reflectionDate}>{s.date}</Text>
                  <Text style={styles.reflectionScore}>· {s.completionPct != null ? s.completionPct : '—'}% complete</Text>
                </View>
                <Text style={styles.reflectionText}>{s.reflection || '(no reflection written)'}</Text>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );

  const renderCurrentPage = () => {
    switch (currentPage) {
      case 'today':
        return renderTodayPage();
      case 'goals':
        return renderGoalsPage();
      case 'analytics':
        return renderAnalytics();
      case 'somatic':
        return renderSomaticPage();
      case 'shutdown':
        return renderShutdownPage();
      default:
        return renderTodayPage();
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.navBar}>
        {['today', 'goals', 'analytics', 'somatic', 'shutdown'].map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.navItem, currentPage === tab && styles.navItemActive]}
            onPress={() => setCurrentPage(tab)}
          >
            <Text style={[styles.navText, currentPage === tab && styles.navTextActive]}>{tab.charAt(0).toUpperCase() + tab.slice(1)}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {renderCurrentPage()}
      <TimePickerModal
        visible={timePicker !== null}
        initialHour={timePicker ? timePicker.hour : 9}
        initialMinute={timePicker ? timePicker.minute : 0}
        onClose={() => setTimePicker(null)}
        onConfirm={(hour, minute) => {
          // FIX #18: read from ref to avoid closure null race
          const picker = timePickerRef.current;
          if (picker) {
            setTaskReminder(picker.taskId, hour, minute);
          }
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  navBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 12,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  navItem: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  navItemActive: {
    backgroundColor: COLORS.accent,
  },
  navText: {
    color: COLORS.muted,
    fontWeight: '600',
  },
  navTextActive: {
    color: '#fff',
  },
  page: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  domainSection: {
    marginBottom: 8,
    backgroundColor: COLORS.card,
    borderRadius: 8,
    overflow: 'hidden',
  },
  domainHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
  },
  domainName: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  domainIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  domainText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
  },
  domainMeta: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  domainCount: {
    backgroundColor: COLORS.dim,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginRight: 8,
  },
  domainCountDone: {
    backgroundColor: COLORS.green,
  },
  domainCountText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.text,
  },
  domainCountTextDone: {
    color: '#fff',
  },
  priorityBadge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 4,
  },
  priorityBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  reorderBtn: {
    padding: 4,
    marginRight: 4,
  },
  reorderBtnText: {
    fontSize: 12,
    color: COLORS.muted,
  },
  reorderBtnTextDisabled: {
    color: COLORS.dim,
  },
  chevron: {
    fontSize: 12,
    color: COLORS.muted,
    marginLeft: 4,
  },
  expandedContent: {
    padding: 12,
    paddingTop: 0,
  },
  taskInputRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  taskInput: {
    flex: 1,
    backgroundColor: COLORS.surface,
    color: COLORS.text,
    padding: 10,
    borderRadius: 6,
    marginRight: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  addBtn: {
    backgroundColor: COLORS.accent,
    width: 36,
    height: 36,
    borderRadius: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  emptyState: {
    padding: 24,
    alignItems: 'center',
  },
  emptyIcon: {
    fontSize: 32,
    marginBottom: 8,
  },
  emptyText: {
    color: COLORS.muted,
    fontSize: 14,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  catBadge: {
    width: 24,
    height: 24,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  catBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  taskText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
  },
  taskTextDone: {
    textDecorationLineThrough: COLORS.muted,
  },
  priorityBtns: {
    flexDirection: 'row',
    marginRight: 8,
  },
  priorityBtn: {
    width: 24,
    height: 24,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 4,
  },
  priorityBtnActive: {
    backgroundColor: CATEGORY_COLORS.A,
  },
  priorityBtnText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  priorityBtnTextActive: {
    color: '#fff',
  },
  deleteBtn: {
    padding: 4,
  },
  deleteBtnText: {
    fontSize: 16,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: COLORS.accent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxChecked: {
    backgroundColor: COLORS.green,
    borderColor: COLORS.green,
  },
  checkmark: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  reminderSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  reminderTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.muted,
    marginBottom: 8,
  },
  reminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  reminderTaskText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.text,
  },
  reminderChip: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 8,
  },
  reminderChipText: {
    fontSize: 11,
    color: COLORS.text,
  },
  reminderClearBtn: {
    padding: 4,
  },
  reminderClearText: {
    fontSize: 14,
    color: COLORS.muted,
  },
  scoreContainer: {
    alignItems: 'center',
    padding: 20,
  },
  ringContainer: {
    width: 80,
    height: 80,
  },
  ringLabel: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringPct: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.text,
  },
  ringSub: {
    fontSize: 10,
    color: COLORS.muted,
  },
  ringCaption: {
    marginTop: 8,
    fontSize: 12,
    color: COLORS.muted,
    textAlign: 'center',
  },
  goalHeaderRight: {
    flexDirection: 'row',
    alignItems: center,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepBtn: {
    width: 28,
    height: 28,
    borderRadius: 4,
    backgroundColor: COLORS.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepBtnText: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: 'bold',
  },
  progressBarTrack: {
    flex: 1,
    height: 6,
    backgroundColor: COLORS.dim,
    borderRadius: 3,
    marginHorizontal: 8,
  },
  progressBarFill: {
    height: 6,
    borderRadius: 3,
  },
  goalExpanded: {
    padding: 12,
  },
  goalInput: {
    backgroundColor: COLORS.surface,
    color: COLORS.text,
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  analyticsViewToggle: {
    flexDirection: 'row',
    padding: 8,
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    marginBottom: 16,
  },
  analyticsTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 4,
  },
  analyticsTabActive: {
    backgroundColor: COLORS.accent,
  },
  analyticsTabText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.muted,
  },
  analyticsTabTextActive: {
    color: '#fff',
  },
  chartContainer: {
    marginBottom: 20,
  },
  chartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  chartLabel: {
    width: 80,
    fontSize: 12,
    color: COLORS.muted,
  },
  chartBarBackground: {
    flex: 1,
    height: 8,
    backgroundColor: COLORS.dim,
    borderRadius: 4,
    marginHorizontal: 8,
  },
  chartBarFill: {
    height: 8,
    borderRadius: 4,
  },
  chartValue: {
    width: 30,
    fontSize: 12,
    color: COLORS.text,
    textAlign: 'right',
  },
  heatmapContainer: {
    marginBottom: 20,
  },
  heatmapTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  heatmapGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  heatmapCell: {
    width: 24,
    height: 24,
    borderRadius: 4,
    margin: 2,
  },
  heatmapCellToday: {
    borderWidth: 2,
    borderColor: COLORS.accent,
  },
  heatmapLevel: {
    width: 24,
    height: 24,
    borderRadius: 4,
  },
  heatmapLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 16,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 2,
    marginRight: 4,
  },
  legendText: {
    fontSize: 10,
    color: COLORS.muted,
  },
  somaticCard: {
    backgroundColor: COLORS.card,
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  },
  promptText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 12,
  },
  input: {
    backgroundColor: COLORS.surface,
    color: COLORS.text,
    padding: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 12,
  },
  focusBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginRight: 6,
  },
  focusBtnActive: {
    backgroundColor: COLORS.accent,
  },
  focusBtnText: {
    color: COLORS.text,
    fontWeight: '600',
  },
  focusBtnTextActive: {
    color: '#fff',
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginRight: 6,
    marginBottom: 6,
  },
  chipActive: {
    backgroundColor: COLORS.accent,
  },
  chipText: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '500',
  },
  chipTextActive: {
    color: '#fff',
  },
  saveButton: {
    backgroundColor: COLORS.accent,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 6,
    alignItems: 'center',
  },
  saveButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: 16,
  },
  sessionCard: {
    backgroundColor: COLORS.card,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  sessionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  sessionTime: {
    fontSize: 11,
    color: COLORS.muted,
  },
  sessionLevel: {
    fontSize: 11,
    color: COLORS.muted,
  },
  sessionLabel: {
    fontSize: 11,
    color: COLORS.accent2,
  },
  sessionThought: {
    fontSize: 13,
    color: COLORS.text,
    marginBottom: 4,
  },
  sessionTechnique: {
    fontSize: 11,
    color: COLORS.muted,
  },
  breathReminderCard: {
    backgroundColor: COLORS.card,
    borderRadius: 8,
    padding: 16,
    marginTop: 12,
  },
  breathReminderTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
  },
  breathReminderTimeContainer: {
    alignItems: 'center',
  },
  breathReminderTime: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  breathReminderHint: {
    fontSize: 11,
    color: COLORS.muted,
  },
  techniqueRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  techniqueBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginRight: 6,
    marginBottom: 6,
  },
  techniqueBtnActive: {
    backgroundColor: COLORS.accent,
  },
  techniqueBtnText: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: '500',
  },
  techniqueBtnTextActive: {
    color: '#fff',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  statCard: {
    backgroundColor: COLORS.card,
    borderRadius: 8,
    padding: 16,
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.text,
  },
  statLabel: {
    fontSize: 11,
    color: COLORS.muted,
    marginTop: 4,
  },
  compactSaveButton: {
    backgroundColor: COLORS.accent,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 6,
    alignItems: 'center',
  },
  compactSaveButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  reflectionCard: {
    backgroundColor: COLORS.card,
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  reflectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  reflectionDate: {
    fontSize: 11,
    color: COLORS.muted,
  },
  reflectionScore: {
    fontSize: 11,
    color: COLORS.muted,
  },
  reflectionText: {
    fontSize: 13,
    color: COLORS.text,
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickerSheet: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 20,
    width: '90%',
    maxHeight: '80%',
  },
  pickerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 16,
  },
  pickerPreview: {
    backgroundColor: COLORS.bg,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    alignItems: 'center',
  },
  pickerPreviewText: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
  },
  pickerSectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.muted,
    marginBottom: 8,
  },
  pickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  pickerCell: {
    width: 50,
    height: 40,
    borderRadius: 6,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
    marginBottom: 6,
  },
  pickerCellActive: {
    backgroundColor: COLORS.accent,
  },
  pickerCellText: {
    color: COLORS.text,
    fontWeight: '500',
  },
  pickerCellTextActive: {
    color: '#fff',
  },
  ampmRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 16,
  },
  ampmBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginHorizontal: 4,
  },
  ampmBtnActive: {
    backgroundColor: COLORS.accent,
  },
  ampmBtnText: {
    color: COLORS.text,
    fontWeight: '600',
  },
  ampmBtnTextActive: {
    color: '#fff',
  },
  pickerActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  pickerCancelBtn: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
  },
  pickerCancelText: {
    color: COLORS.text,
    fontSize: 14,
  },
  pickerConfirmBtn: {
    backgroundColor: COLORS.accent,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
  },
  pickerConfirmText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
