import React, { useState, useEffect, useRef } from 'react';
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
  AppState,
  Linking,
  PanResponder,
  Animated,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Svg, Circle } from 'react-native-svg';
import {
  setupNotifications,
  scheduleBreathReminder,
  cancelBreathReminder,
  scheduleTaskReminder,
  cancelTaskReminder,
  getScheduledNotificationsCount,
  scheduleTestNotification,
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

// The seven life domains shared across Goals and Today tabs.
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

// Activity-heatmap fill colors, indexed by heat level 0-4.
// 0 = empty, 1-25% = l1, 26-50% = l2, 51-75% = l3, 76-100% = l4.
const HEAT_COLORS = [
  COLORS.dim,
  'rgba(124,92,252,0.2)',
  'rgba(124,92,252,0.4)',
  'rgba(124,92,252,0.65)',
  COLORS.accent,
];

const defaultGoals = () => {
  const g = {};
  LIFE_DOMAINS.forEach((d) => { g[d.name] = { goalText: '', progress: 0 }; });
  return g;
};

const STORAGE_KEY = (date) => 'muhsanTracker_' + date;

// Clock-style time picker shown in a modal bottom sheet. Mirrors the
// "tap hour → AM/PM → minute" flow. onConfirm receives (hour24, minute).
const TimePickerModal = ({ visible, initialHour, initialMinute, onClose, onConfirm }) => {
  const [hour12, setHour12] = useState(initialHour % 12 === 0 ? 12 : initialHour % 12);
  const [minute, setMinute] = useState(initialMinute);
  const [isPM, setIsPM] = useState(initialHour >= 12);

  // Re-sync to incoming values each time the modal opens.
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

          {/* Live preview of the selected time */}
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

export default function App() {
  const [currentDate, setCurrentDate] = useState(new Date().toISOString().split('T')[0]);
  const [tasks, setTasks] = useState({});
  const [currentPage, setCurrentPage] = useState('goals');

  // Long-term goals: { Domain: { goalText, progress } }
  const [goals, setGoals] = useState(defaultGoals());

  // Today tasks: [{ id, domain, text, category, completed }]
  const [todayTasks, setTodayTasks] = useState([]);

  // Per-domain inline add inputs.
  const [domainInputs, setDomainInputs] = useState({});

  // Task reminders: { taskId: time }
  const [taskReminders, setTaskReminders] = useState({});

  // Domain expansion state
  const [expandedDomains, setExpandedDomains] = useState({});

  // Somatic awareness session entry + history.
  const [somaticData, setSomaticData] = useState({
    focusLevel: null,
    thoughts: '',
    thoughtLabel: '',
    technique: null,
  });
  const [somaticLogs, setSomaticLogs] = useState([]);

  // Shutdown reflection + history.
  const [showShutdown, setShowShutdown] = useState(false);
  const [shutdownReflection, setShutdownReflection] = useState('');
  const [dailyShutdowns, setDailyShutdowns] = useState([]);

  // Analytics view + notification interval.
  const [analyticsView, setAnalyticsView] = useState('daily');
  const [reminderInterval, setReminderInterval] = useState(0);

  // Notification diagnostics: how many alarms the OS currently has registered
  // for this app. Drops to 0 when a force-stop wipes them (aggressive ROMs).
  const [scheduledCount, setScheduledCount] = useState(Platform.OS === 'web' ? -1 : null);

  // Domain reordering state
  const [domainOrder, setDomainOrder] = useState(LIFE_DOMAINS.map(d => d.name));

  // Activity heatmap: 28 heat levels (0-4) for the last 28 days.
  const [heatmapLevels, setHeatmapLevels] = useState(Array(28).fill(0));

  // Time-picker modal: { taskId, taskText, hour, minute } or null when closed.
  const [timePicker, setTimePicker] = useState(null);

  // Load saved day whenever the date changes.
  useEffect(() => { loadData(); }, [currentDate]);

  // Load reminder interval on app start
  useEffect(() => {
    loadReminderInterval();
  }, []);

  // Set up push notifications and route taps to the Somatic tab.
  useEffect(() => {
    setupNotifications(() => setCurrentPage('somatic'));
  }, []);

  // Seed the diagnostics counter after notifications are set up
  useEffect(() => {
    if (Platform.OS !== 'web') {
      getScheduledNotificationsCount().then(n => setScheduledCount(n)).catch(() => setScheduledCount(-1));
    }
  }, []);

  // Re-check scheduled notifications when the app returns to the foreground
  useEffect(() => {
    if (Platform.OS === 'web') return;
    
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        getScheduledNotificationsCount().then(n => setScheduledCount(n)).catch(() => setScheduledCount(-1));
      }
    });
    return () => sub.remove();
  }, []);

  // Refresh the 28-day activity heatmap whenever the current date changes
  // or after a save (so completing today's tasks lights up its cell).
  useEffect(() => {
    loadHeatmapData();
  }, [currentDate, tasks, todayTasks]);

  const loadData = async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY(currentDate));
      if (raw) {
        const parsed = JSON.parse(raw);
        setTasks(parsed.tasks || {});
        setGoals(parsed.goals || defaultGoals());
        // Guard old tasks that lack a domain.
        setTodayTasks((parsed.todayTasks || []).map((t) => ({
          ...t,
          domain: t.domain || 'Personal Growth',
        })));
        setSomaticLogs(parsed.somaticLogs || []);
        setDailyShutdowns(parsed.dailyShutdowns || []);
        setTaskReminders(parsed.taskReminders || {});
        setExpandedDomains(parsed.expandedDomains || {});
      } else {
        setTasks({});
        setGoals(defaultGoals());
        setTodayTasks([]);
        setSomaticLogs([]);
        setDailyShutdowns([]);
        setTaskReminders({});
        setExpandedDomains({});
      }
      
      // Load domain order
      try {
        const savedOrder = await AsyncStorage.getItem('domainOrder');
        if (savedOrder) {
          setDomainOrder(JSON.parse(savedOrder));
        }
      } catch (e) {
        console.error('Failed to load domain order:', e);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    }
  };

  const loadReminderInterval = async () => {
    try {
      const interval = await AsyncStorage.getItem('reminderInterval');
      if (interval) {
        setReminderInterval(parseFloat(interval));
      }
    } catch (error) {
      console.error('Error loading reminder interval:', error);
    }
  };

  // Build the 28-cell heatmap from AsyncStorage day records. Each cell maps
  // a day's task completion rate to a heat level (0-4). Today's in-memory
  // state is used for the current day so the cell updates live.
  const loadHeatmapData = async () => {
    try {
      const levels = [];
      const today = new Date();
      for (let i = 27; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const key = d.toISOString().split('T')[0];
        let rate = 0;
        if (key === currentDate) {
          // Use live in-memory state for today.
          if (todayTasks.length > 0) {
            const done = todayTasks.filter((t) => tasks[t.id]).length;
            rate = Math.round((done / todayTasks.length) * 100);
          }
        } else {
          const raw = await AsyncStorage.getItem('muhsanTracker_' + key);
          if (raw) {
            const parsed = JSON.parse(raw);
            const list = parsed.todayTasks || [];
            if (list.length > 0) {
              const done = list.filter((t) => parsed.tasks && parsed.tasks[t.id]).length;
              rate = Math.round((done / list.length) * 100);
            }
          }
        }
        let level = 0;
        if (rate > 0 && rate <= 25) level = 1;
        else if (rate <= 50) level = 2;
        else if (rate <= 75) level = 3;
        else if (rate > 75) level = 4;
        levels.push(level);
      }
      setHeatmapLevels(levels);
    } catch (error) {
      console.error('Error loading heatmap data:', error);
    }
  };

  const saveData = async (silent) => {
    try {
      const dataToSave = {
        tasks,
        goals,
        todayTasks,
        somaticLogs,
        dailyShutdowns,
        taskReminders,
        expandedDomains,
        date: currentDate,
      };
      await AsyncStorage.setItem(STORAGE_KEY(currentDate), JSON.stringify(dataToSave));
      if (!silent) Alert.alert('Saved', 'Day saved 🔥');
    } catch (error) {
      Alert.alert('Error', 'Failed to save data');
    }
  };

  // ─── Goals ────────────────────────────────────────────────────────────────
  const updateGoalText = (domain, text) => {
    setGoals({ ...goals, [domain]: { ...goals[domain], goalText: text } });
  };
  const updateGoalProgress = (domain, delta) => {
    const next = Math.max(0, Math.min(100, (goals[domain]?.progress || 0) + delta));
    setGoals({ ...goals, [domain]: { ...goals[domain], progress: next } });
  };
  const toggleDomain = (domain) => {
    LayoutAnimation.easeInEaseOut();
    setExpandedDomains({ ...expandedDomains, [domain]: !expandedDomains[domain] });
  };

  // ─── Today tasks ──────────────────────────────────────────────────────────
  const addDomainTask = (domain) => {
    const text = (domainInputs[domain] || '').trim();
    if (!text) return;
    setTodayTasks([
      ...todayTasks,
      { id: Date.now() + Math.random(), domain, text, category: 'C', completed: false },
    ]);
    setDomainInputs({ ...domainInputs, [domain]: '' });
  };
  const deleteTask = async (taskId) => {
    // Cancel any scheduled notification before dropping the reminder entry.
    const existing = taskReminders[taskId];
    if (existing && existing.notifId) {
      await cancelTaskReminder(existing.notifId);
    }
    setTodayTasks(todayTasks.filter((t) => t.id !== taskId));
    const newReminders = { ...taskReminders };
    delete newReminders[taskId];
    setTaskReminders(newReminders);
  };
  const setTaskCategory = (taskId, category) => {
    setTodayTasks(todayTasks.map((t) => (t.id === taskId ? { ...t, category } : t)));
  };
  // Schedule (or replace) a daily task reminder at the given 24h time.
  const setTaskReminder = async (taskId, hour, minute) => {
    const task = todayTasks.find((t) => t.id === taskId);
    // Cancel any previously scheduled notification for this task first.
    const prev = taskReminders[taskId];
    if (prev && prev.notifId) {
      await cancelTaskReminder(prev.notifId);
    }
    const notifId = await scheduleTaskReminder(task ? task.text : '', hour, minute);
    const ampmHour = hour % 12 === 0 ? 12 : hour % 12;
    const ampm = hour < 12 ? 'AM' : 'PM';
    const mm = String(minute).padStart(2, '0');
    setTaskReminders({
      ...taskReminders,
      [taskId]: { time: `${ampmHour}:${mm} ${ampm}`, hour, minute, notifId },
    });
  };
  // Clear a task's reminder (cancels the notification).
  const clearTaskReminder = async (taskId) => {
    const prev = taskReminders[taskId];
    if (prev && prev.notifId) {
      await cancelTaskReminder(prev.notifId);
    }
    const newReminders = { ...taskReminders };
    delete newReminders[taskId];
    setTaskReminders(newReminders);
  };
  const toggleTask = (taskId) => {
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

  const ProgressRing = ({ progress }) => {
    const radius = 36;
    const strokeWidth = 7;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (progress / 100) * circumference;

    return (
      <View style={styles.progressRingWrap}>
        <Svg width={80} height={80} style={styles.ringContainer}>
          <Circle
            stroke={COLORS.border}
            strokeWidth={strokeWidth}
            fill="transparent"
            r={radius}
            cx={40}
            cy={40}
          />
          <Circle
            stroke={COLORS.accent}
            strokeWidth={strokeWidth}
            fill="transparent"
            r={radius}
            cx={40}
            cy={40}
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
  const getScoreMessage = (score) => {
    if (score < 25) return 'Log your day 💪';
    if (score < 50) return 'Good start 🌙';
    if (score < 75) return "You're on fire ⚡";
    if (score < 100) return 'Almost there 🚀';
    return 'Perfect discipline 🏆';
  };

  const shiftDate = (days) => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + days);
    setCurrentDate(d.toISOString().split('T')[0]);
  };
  const goToToday = () => setCurrentDate(new Date().toISOString().split('T')[0]);

  // ─── Somatic ──────────────────────────────────────────────────────────────
  const logSomaticState = () => {
    const entry = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      focusLevel: somaticData.focusLevel,
      thoughts: somaticData.thoughts,
      thoughtLabel: somaticData.thoughtLabel,
      technique: somaticData.technique,
    };
    const updated = [...somaticLogs, entry];
    setSomaticLogs(updated);
    // Reset the active input area for the next entry.
    setSomaticData({ focusLevel: null, thoughts: '', thoughtLabel: '', technique: null });
  };

  // ─── Shutdown ─────────────────────────────────────────────────────────────
  const completeShutdown = () => {
    const shutdown = {
      id: Date.now(),
      date: currentDate,
      reflection: shutdownReflection,
      completionPct: calculateScore(),
      shutdownTime: new Date().toISOString(),
    };
    setDailyShutdowns([...dailyShutdowns, shutdown]);
    setShutdownReflection('');
    saveData(true);
    Alert.alert('Shutdown Complete', 'Day logged. Get some rest 😴');
  };

  // ─── Notifications ────────────────────────────────────────────────────────
  const changeReminder = async (hours) => {
    setReminderInterval(hours);
    await AsyncStorage.setItem('reminderInterval', hours.toString());
    if (hours > 0) {
      await scheduleBreathReminder(hours);
    } else {
      await cancelBreathReminder();
    }
    if (Platform.OS !== 'web') {
      getScheduledNotificationsCount().then(n => setScheduledCount(n)).catch(() => setScheduledCount(-1));
    }
  };

  const openBatterySettings = () => {
    if (Platform.OS === 'web') {
      Alert.alert('Notifications', 'Battery settings are only available on native platforms. This feature will work on Android.');
      return;
    }
    if (Platform.OS !== 'android') {
      Alert.alert('Notifications', 'Background delivery settings are Android-only.');
      return;
    }
    Alert.alert(
      'Keep reminders alive in the background',
      'Some phones (Xiaomi, Samsung, Oppo, Vivo, Huawei) kill scheduled reminders when you swipe the app away from recents. To fix this, open the app settings and enable:\n\n• Autostart / Auto-launch\n• Battery: Unrestricted / No restrictions\n• Allow background activity\n\nTap OK to open the app settings page.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open settings', onPress: () => Linking.openSettings() },
      ],
    );
  };

  // ─── Render: Long-Term Goals ──────────────────────────────────────────────
  const renderGoalsPage = () => (
    <View style={styles.page}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Long-Term Goals</Text>
        <Text style={styles.dateLabel}>
          {new Date(currentDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </Text>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {LIFE_DOMAINS.map((domain) => {
          const goal = goals[domain.name];
          const isExpanded = expandedDomains[domain.name];
          const hasContent = (goal?.goalText && goal.goalText.trim()) || (goal?.progress || 0) > 0;

          return (
            <View key={domain.name} style={[styles.goalCard, !hasContent && !isExpanded && styles.goalCardDim]}>
              <TouchableOpacity
                style={styles.goalDomainRow}
                onPress={() => toggleDomain(domain.name)}
                activeOpacity={0.7}
              >
                <View style={styles.goalDomainName}>
                  <Text style={styles.domainIcon}>{domain.icon}</Text>
                  <Text style={styles.goalDomainText}>{domain.name}</Text>
                  {!isExpanded && !hasContent && (
                    <Text style={styles.goalPlaceholderInline}>No goal set</Text>
                  )}
                </View>
                <View style={styles.goalHeaderRight}>
                  <View style={styles.progressRow}>
                    <TouchableOpacity style={styles.stepBtn} onPress={(e) => { e.stopPropagation && e.stopPropagation(); updateGoalProgress(domain.name, -10); }}>
                      <Text style={styles.stepBtnText}>−</Text>
                    </TouchableOpacity>
                    <Text style={styles.progressText}>{goal?.progress || 0}%</Text>
                    <TouchableOpacity style={styles.stepBtn} onPress={(e) => { e.stopPropagation && e.stopPropagation(); updateGoalProgress(domain.name, 10); }}>
                      <Text style={styles.stepBtnText}>+</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.goalProgressRow}>
                    <View style={styles.progressBarTrack}>
                      <View style={[styles.progressBarFill, { width: `${goal?.progress || 0}%` }]} />
                    </View>
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

  // ─── Render: Today ────────────────────────────────────────────────────────
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
        
        <ScrollView style={styles.scroll}>
          {domainOrder.map((domainName, index) => {
            const domain = LIFE_DOMAINS.find(d => d.name === domainName);
            if (!domain) return null;
            
            const list = sortedTasks(domain.name);
            const isExpanded = expandedDomains[domain.name];
            const count = list.length;
            const doneCount = list.filter((t) => tasks[t.id]).length;
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
                      onPress={() => {
                        if (index > 0) {
                          const newOrder = [...domainOrder];
                          [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
                          setDomainOrder(newOrder);
                          AsyncStorage.setItem('domainOrder', JSON.stringify(newOrder));
                        }
                      }}
                      disabled={index === 0}
                    >
                      <Text style={[styles.reorderBtnText, index === 0 && styles.reorderBtnTextDisabled]}>▲</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={styles.reorderBtn}
                      onPress={() => {
                        if (index < domainOrder.length - 1) {
                          const newOrder = [...domainOrder];
                          [newOrder[index + 1], newOrder[index]] = [newOrder[index], newOrder[index + 1]];
                          setDomainOrder(newOrder);
                          AsyncStorage.setItem('domainOrder', JSON.stringify(newOrder));
                        }
                      }}
                      disabled={index === domainOrder.length - 1}
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
                        placeholderTextColor={COLORS.muted}
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
                      list.map((task) => (
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
                      ))
                    )}
                    
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
                                  {rem ? `⏰ ${rem.time}` : '+ Set time'}
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
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      </View>
    );
  };

  // ─── Render: Analytics ────────────────────────────────────────────────────
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
    const score = calculateScore();
    const completed = todayTasks.filter((t) => tasks[t.id]).length;
    
    return (
      <View style={styles.page}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Analytics</Text>
        </View>
        <View style={styles.analyticsTabs}>
          {['daily', 'weekly', 'monthly'].map((v) => (
            <TouchableOpacity
              key={v}
              style={[styles.analyticsTab, analyticsView === v && styles.analyticsTabActive]}
              onPress={() => setAnalyticsView(v)}
            >
              <Text style={[styles.analyticsTabText, analyticsView === v && styles.analyticsTabTextActive]}>
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <ScrollView style={styles.scroll}>
          <View style={styles.statRow}>
            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: COLORS.green }]}>0</Text>
              <Text style={styles.statLabel}>STREAK</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{todayTasks.length}</Text>
              <Text style={styles.statLabel}>TASKS</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{score}%</Text>
              <Text style={styles.statLabel}>RATE</Text>
            </View>
          </View>
          
          <View style={styles.heatmapSection}>
            <Text style={styles.heatmapTitle}>Activity</Text>
            <View style={styles.heatmapDays}>
              {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day) => (
                <Text key={day} style={styles.heatmapDayLabel}>{day}</Text>
              ))}
            </View>
            <View style={styles.heatmapGrid}>
              {heatmapLevels.map((level, i) => (
                <View
                  key={i}
                  style={[
                    styles.heatmapCell,
                    { backgroundColor: HEAT_COLORS[level] || HEAT_COLORS[0] },
                    i === heatmapLevels.length - 1 && styles.heatmapCellToday,
                  ]}
                />
              ))}
            </View>
          </View>
          
          <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>Completion Rate by Domain</Text>
            {renderBarChart(domainStats())}
          </View>
          <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>Task Completion</Text>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Total Tasks</Text>
              <Text style={styles.statValue}>{todayTasks.length}</Text>
            </View>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Completed</Text>
              <Text style={styles.statValue}>{completed}</Text>
            </View>
            <View style={styles.statRow}>
              <Text style={styles.statLabel}>Completion Rate</Text>
              <Text style={styles.statValue}>{score}%</Text>
            </View>
          </View>
        </ScrollView>
      </View>
    );
  };

  // ─── Render: Somatic ──────────────────────────────────────────────────────
  const renderSomaticPage = () => (
    <View style={styles.page}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Somatic Awareness</Text>
      </View>
      <ScrollView style={styles.scroll}>
        <Text style={styles.question}>
          Do you have focus on your breath, heart rate, or the movement of your chest?
        </Text>

        <View style={styles.percentGrid}>
          {[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((p) => (
            <TouchableOpacity
              key={p}
              style={[styles.percentBtn, somaticData.focusLevel === p && styles.percentBtnActive]}
              onPress={() => setSomaticData({ ...somaticData, focusLevel: p })}
            >
              <Text style={[styles.percentBtnText, somaticData.focusLevel === p && styles.percentBtnTextActive]}>{p}%</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.promptText}>
          What thoughts are running in your mind and what label do you choose for it?
        </Text>
        <TextInput
          style={styles.input}
          value={somaticData.thoughts}
          onChangeText={(t) => setSomaticData({ ...somaticData, thoughts: t })}
          placeholder="Describe the thoughts..."
          placeholderTextColor={COLORS.muted}
          multiline
        />
        <TextInput
          style={styles.input}
          value={somaticData.thoughtLabel}
          onChangeText={(t) => setSomaticData({ ...somaticData, thoughtLabel: t })}
          placeholder="Label (anxiety, fear, calm...)"
          placeholderTextColor={COLORS.muted}
        />

        <Text style={styles.promptText}>Technique for moving on work</Text>
        <View style={styles.chipRow}>
          {['⚡ Present-Past Game', '🔄 Opportunity Game'].map((tech) => (
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
                  <Text style={styles.sessionTime}>
                    {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · Focus {log.focusLevel || '—'}% · {log.thoughtLabel || 'No label'}
                  </Text>
                  <Text style={styles.sessionTechnique}>{log.technique || 'No technique'}</Text>
                </View>
                {log.thoughts && <Text style={styles.sessionThoughts}>{log.thoughts}</Text>}
              </View>
            ))}
          </>
        )}

        <View style={styles.divider} />
        <Text style={styles.promptText}>Breath Reminder</Text>
        <View style={styles.techniqueRow}>
          {[{ label: 'Off', h: 0 }, { label: '2m', h: 2/60 }, { label: '1h', h: 1 }, { label: '2h', h: 2 }, { label: '4h', h: 4 }].map((opt) => (
            <TouchableOpacity
              key={opt.label}
              style={[styles.techniqueBtn, reminderInterval === opt.h && styles.techniqueBtnActive]}
              onPress={() => changeReminder(opt.h)}
            >
              <Text style={[styles.techniqueBtnText, reminderInterval === opt.h && styles.techniqueBtnTextActive]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.helperText}>Use 2m to test that a notification actually arrives.</Text>

        <View style={styles.divider} />
        <View style={styles.divider} />
        <View style={styles.notifDiagCard}>
          <Text style={styles.notifDiagTitle}>Notification Diagnostics</Text>
          <View style={styles.notifDiagLine}>
            <Text style={styles.notifDiagHint}>Scheduled alarms: </Text>
            <Text style={styles.notifDiagBold}>{scheduledCount === null ? 'Loading...' : scheduledCount === -1 ? 'Not available' : scheduledCount}</Text>
          </View>
          <Text style={styles.notifDiagHint}>
            {scheduledCount === 0 ? 'No alarms scheduled. Force-stopping the app can wipe them.' : scheduledCount > 0 ? 'Alarms are registered with the OS.' : 'Check your notification permissions.'}
          </Text>
          {Platform.OS !== 'web' && (
            <>
              <TouchableOpacity style={styles.notifDiagBtn} onPress={openBatterySettings}>
                <Text style={styles.notifDiagBtnText}>Keep reminders alive (open settings)</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.notifDiagTest} onPress={async () => {
                await scheduleTestNotification();
                Alert.alert('Test Sent', 'A test notification should arrive in 1 second. If you don\'t see it, check your notification permissions.');
              }}>
                <Text style={styles.notifDiagTestText}>Send test notification</Text>
              </TouchableOpacity>
            </>
          )}
          <TouchableOpacity style={styles.notifDiagRefresh} onPress={() => getScheduledNotificationsCount().then(n => setScheduledCount(n)).catch(() => setScheduledCount(-1))}>
            <Text style={styles.notifDiagRefreshText}>Re-check now</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );

  // ─── Render: Shutdown ─────────────────────────────────────────────────────
  const renderShutdownPage = () => {
    const score = calculateScore();
    const completed = todayTasks.filter((t) => tasks[t.id]).length;
    
    return (
      <View style={styles.page}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Shutdown Ritual</Text>
        </View>
        <ScrollView style={styles.scroll}>
          <View style={styles.heroCard}>
            <Text style={styles.heroEmoji}>🌙</Text>
            <Text style={styles.heroTitle}>Close the day with intention</Text>
            <Text style={styles.heroDate}>{currentDate}</Text>
          </View>
          
          <View style={styles.statRow}>
            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: COLORS.green }]}>{completed}</Text>
              <Text style={styles.statLabel}>TASKS DONE</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: COLORS.amber }]}>{score}%</Text>
              <Text style={styles.statLabel}>COMPLETION</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: COLORS.accent2 }]}>{somaticLogs.length}</Text>
              <Text style={styles.statLabel}>SOMATIC LOGS</Text>
            </View>
          </View>
          
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
  };

  // ─── Render: Navigation ───────────────────────────────────────────────────
  // Single icon + plain label per tab (no duplicated/stacked icons).
  const renderNavigation = () => {
    const pages = [
      { id: 'goals', icon: '🎯', label: 'Goals' },
      { id: 'today', icon: '📋', label: 'Today' },
      { id: 'analytics', icon: '📊', label: 'Analytics' },
      { id: 'somatic', icon: '🧠', label: 'Somatic' },
      { id: 'shutdown', icon: '😴', label: 'Shutdown' },
    ];
    return (
      <View style={styles.navigation}>
        {pages.map((page) => (
          <TouchableOpacity
            key={page.id}
            style={[styles.navItem, currentPage === page.id && styles.navItemActive]}
            onPress={() => setCurrentPage(page.id)}
          >
            <Text style={styles.navIcon}>{page.icon}</Text>
            <Text style={[styles.navLabel, currentPage === page.id && styles.navLabelActive]}>{page.label}</Text>
            {currentPage === page.id && <View style={styles.navDot} />}
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  const renderPage = () => {
    switch (currentPage) {
      case 'goals': return renderGoalsPage();
      case 'today': return renderTodayPage();
      case 'analytics': return renderAnalytics();
      case 'somatic': return renderSomaticPage();
      case 'shutdown': return renderShutdownPage();
      default: return renderGoalsPage();
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
      {renderPage()}
      {renderNavigation()}
      <TimePickerModal
        visible={timePicker !== null}
        initialHour={timePicker ? timePicker.hour : 9}
        initialMinute={timePicker ? timePicker.minute : 0}
        onClose={() => setTimePicker(null)}
        onConfirm={(hour, minute) => {
          if (timePicker) {
            setTaskReminder(timePicker.taskId, hour, minute);
          }
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  page: { flex: 1, padding: 12 },
  sectionHeader: { marginBottom: 8, paddingTop: 4 },
  sectionTitle: { fontSize: 14, fontWeight: 'bold', color: COLORS.text, letterSpacing: 0.3 },
  dateLabel: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 20 },

  // Progress Ring
  progressRingWrap: { alignItems: 'center', padding: 16, paddingBottom: 8 },
  ringContainer: { transform: [{ rotate: '-90deg' }] },
  ringLabel: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  ringPct: { fontSize: 18, fontWeight: 'bold', color: COLORS.accent2 },
  ringSub: { fontSize: 9, color: COLORS.muted, fontWeight: '500' },
  ringCaption: { fontSize: 11, color: COLORS.muted, textAlign: 'center', marginTop: 8 },

  // Domain Sections
  domainSection: { marginHorizontal: 0, marginBottom: 6 },
  domainHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 10, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14 },
  domainName: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  domainIcon: { fontSize: 15 },
  domainText: { fontSize: 13, fontWeight: '600', color: COLORS.text },
  domainMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  domainCount: { backgroundColor: COLORS.surface, paddingVertical: 2, paddingHorizontal: 7, borderRadius: 99, borderWidth: 1, borderColor: COLORS.border },
  domainCountDone: { backgroundColor: 'rgba(34,200,122,0.15)', borderColor: COLORS.green },
  domainCountText: { fontSize: 10, color: COLORS.muted },
  domainCountTextDone: { color: COLORS.green, fontWeight: 'bold' },
  reorderBtn: { padding: 4 },
  reorderBtnText: { fontSize: 12, color: COLORS.muted },
  reorderBtnTextDisabled: { color: COLORS.dim },
  priorityBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  priorityBadgeText: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  chevron: { color: COLORS.muted, fontSize: 10 },
  expandedContent: { padding: 8, backgroundColor: 'rgba(124,92,252,0.04)', borderWidth: 1, borderColor: COLORS.border, borderTopWidth: 0, borderBottomLeftRadius: 14, borderBottomRightRadius: 14, marginTop: -1 },
  
  // Task Input
  taskInputRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  taskInput: { flex: 1, backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, padding: 7, color: COLORS.muted, fontSize: 11 },
  addBtn: { backgroundColor: COLORS.accent, borderRadius: 8, width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  // Empty State
  emptyState: { alignItems: 'center', padding: 16 },
  emptyIcon: { fontSize: 24, marginBottom: 8 },
  emptyText: { color: COLORS.muted, fontSize: 12, textAlign: 'center' },

  // Cards / inputs
  card: { backgroundColor: COLORS.card, padding: 12, borderRadius: 12, marginBottom: 8 },
  cardTitle: { fontSize: 14, fontWeight: 'bold', color: COLORS.text, marginBottom: 6 },
  input: { backgroundColor: COLORS.surface, borderRadius: 8, padding: 8, color: COLORS.text, borderWidth: 1, borderColor: COLORS.border, minHeight: 36 },
  inputRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },

  // Progress
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBtn: { backgroundColor: COLORS.surface, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  stepBtnText: { color: COLORS.text, fontSize: 14, fontWeight: 'bold' },
  progressText: { color: COLORS.accent, fontSize: 13, fontWeight: 'bold', minWidth: 40, textAlign: 'center' },
  progressBar: { height: 4, backgroundColor: COLORS.border, borderRadius: 3, marginTop: 4, overflow: 'hidden' },
  progressBarFill: { height: 4, backgroundColor: COLORS.accent },

  // Date nav
  dateNav: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  dateButton: { backgroundColor: COLORS.card, borderRadius: 8, padding: 8, marginHorizontal: 3 },
  dateButtonText: { color: COLORS.text, fontSize: 14 },
  dateInput: { flex: 1, color: COLORS.text, textAlign: 'center', fontSize: 12 },
  todayButton: { backgroundColor: COLORS.accent, borderRadius: 8, padding: 8 },
  todayButtonText: { color: COLORS.bg, fontWeight: 'bold', fontSize: 12 },

  // Score
  scoreContainer: { backgroundColor: COLORS.card, padding: 12, borderRadius: 12, marginBottom: 8, alignItems: 'center' },
  scoreText: { fontSize: 36, fontWeight: 'bold', color: COLORS.accent },
  scoreMessage: { fontSize: 14, color: COLORS.text, marginTop: 4 },

  // Task rows
  taskRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, flexWrap: 'wrap' },
  catBadge: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginRight: 6 },
  catBadgeText: { color: COLORS.bg, fontWeight: 'bold', fontSize: 10 },
  taskText: { flex: 1, color: COLORS.text, fontSize: 14 },
  taskTextDone: { textDecorationLine: 'line-through', color: COLORS.muted },
  priorityBtns: { flexDirection: 'row', marginRight: 6 },
  priorityBtn: { paddingHorizontal: 4, paddingVertical: 3, borderRadius: 6, backgroundColor: COLORS.surface, marginHorizontal: 1 },
  priorityBtnActive: { backgroundColor: COLORS.accent },
  priorityBtnText: { color: COLORS.muted, fontSize: 10, fontWeight: 'bold' },
  priorityBtnTextActive: { color: COLORS.bg },
  deleteBtn: { marginLeft: 4, padding: 4 },
  deleteBtnText: { fontSize: 16 },
  checkbox: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: COLORS.muted, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  checkmark: { color: COLORS.bg, fontWeight: 'bold', fontSize: 12 },

  // Task reminders
  reminderSection: { marginTop: 8, padding: 8, backgroundColor: COLORS.surface, borderRadius: 8 },
  reminderTitle: { fontSize: 12, fontWeight: 'bold', color: COLORS.text, marginBottom: 4 },
  reminderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  reminderTaskText: { flex: 1, color: COLORS.text, fontSize: 12, marginRight: 8 },
  reminderChip: { backgroundColor: COLORS.card, borderRadius: 99, paddingVertical: 5, paddingHorizontal: 10, borderWidth: 1, borderColor: COLORS.border },
  reminderChipText: { color: COLORS.accent2, fontSize: 11, fontWeight: '600' },
  reminderClearBtn: { marginLeft: 6, padding: 4 },
  reminderClearText: { color: COLORS.muted, fontSize: 13 },

  // Goals
  goalCard: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, padding: 6, marginBottom: 3 },
  goalCardDim: { opacity: 0.5 },
  goalDomainRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  goalDomainName: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 },
  goalDomainText: { fontSize: 11, fontWeight: '600', color: COLORS.text },
  goalPlaceholderInline: { fontSize: 8, color: COLORS.muted, fontStyle: 'italic', marginLeft: 3 },
  goalHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  goalExpanded: { marginTop: 4 },
  goalInput: { backgroundColor: COLORS.surface, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 4, color: COLORS.text, borderWidth: 1, borderColor: COLORS.border, minHeight: 25, fontSize: 11 },
  goalProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 6 },
  progressBarTrack: { width: 100, height: 10, backgroundColor: COLORS.dim, borderRadius: 99, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, minWidth: 100 },
  progressBarFill: { height: 10, backgroundColor: COLORS.accent, minWidth: 0 },

  // Somatic
  question: { fontSize: 16, fontWeight: 'bold', color: COLORS.text, marginBottom: 12, textAlign: 'center' },
  promptText: { fontSize: 12, color: COLORS.muted, marginTop: 12, marginBottom: 6 },
  helperText: { fontSize: 10, color: COLORS.dim, marginTop: 4, fontStyle: 'italic' },
  percentGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  percentBtn: { width: '18%', backgroundColor: COLORS.surface, borderRadius: 6, paddingVertical: 10, alignItems: 'center', marginVertical: 3, borderWidth: 1, borderColor: COLORS.border },
  percentBtnActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  percentBtnText: { color: COLORS.text, fontWeight: 'bold', fontSize: 12 },
  percentBtnTextActive: { color: COLORS.bg },
  techniqueRow: { flexDirection: 'row', flexWrap: 'wrap' },
  techniqueBtn: { backgroundColor: COLORS.surface, borderRadius: 6, paddingVertical: 10, paddingHorizontal: 12, marginVertical: 3, marginRight: 6, borderWidth: 1, borderColor: COLORS.border },
  techniqueBtnActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  techniqueBtnText: { color: COLORS.text, fontSize: 12 },
  techniqueBtnTextActive: { color: COLORS.bg },
  chipScroll: { flexDirection: 'row', marginBottom: 8 },
  chipRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  chip: { flex: 1, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 8, alignItems: 'center' },
  chipActive: { backgroundColor: 'rgba(124,92,252,0.15)', borderColor: COLORS.accent },
  chipText: { color: COLORS.muted, fontSize: 11, textAlign: 'center' },
  chipTextActive: { color: COLORS.accent2 },
  sessionCard: { backgroundColor: COLORS.card, borderRadius: 8, padding: 10, marginBottom: 6 },
  sessionHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  sessionTime: { color: COLORS.accent, fontSize: 11 },
  sessionTechnique: { color: COLORS.text, fontSize: 11 },
  sessionThoughts: { color: COLORS.text, fontSize: 12 },

  // History
  historyTitle: { fontSize: 14, fontWeight: 'bold', color: COLORS.text, marginTop: 16, marginBottom: 6 },
  historyItem: { backgroundColor: COLORS.card, borderRadius: 6, padding: 10, marginBottom: 6 },
  historyDate: { color: COLORS.accent, fontSize: 11, marginBottom: 3 },
  historyText: { color: COLORS.text, fontSize: 12 },
  divider: { height: 1, backgroundColor: COLORS.border, marginVertical: 12 },

  // Analytics
  analyticsTabs: { flexDirection: 'row', marginBottom: 8 },
  analyticsTab: { flex: 1, padding: 8, backgroundColor: COLORS.card, borderRadius: 6, marginHorizontal: 3, alignItems: 'center' },
  analyticsTabActive: { backgroundColor: COLORS.accent },
  analyticsTabText: { color: COLORS.text, fontSize: 12 },
  analyticsTabTextActive: { color: COLORS.bg, fontWeight: 'bold' },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  statBox: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, padding: 12, flex: 1, marginHorizontal: 4, alignItems: 'center' },
  statValue: { fontSize: 18, fontWeight: 'bold', color: COLORS.text },
  statLabel: { fontSize: 10, color: COLORS.muted, marginTop: 4 },
  chartCard: { backgroundColor: COLORS.card, padding: 12, borderRadius: 12, marginBottom: 8 },
  chartTitle: { fontSize: 14, fontWeight: 'bold', color: COLORS.text, marginBottom: 8 },
  chartContainer: { backgroundColor: COLORS.surface, padding: 8, borderRadius: 8 },
  chartRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  chartLabel: { width: 80, color: COLORS.text, fontSize: 12 },
  chartBarBackground: { flex: 1, height: 8, backgroundColor: COLORS.border, borderRadius: 4, marginHorizontal: 8 },
  chartBarFill: { height: 8, backgroundColor: COLORS.accent, borderRadius: 4 },
  chartValue: { width: 40, color: COLORS.text, fontSize: 12, textAlign: 'right' },
  heatmapSection: { backgroundColor: COLORS.card, padding: 12, borderRadius: 12, marginBottom: 8 },
  heatmapTitle: { fontSize: 14, fontWeight: 'bold', color: COLORS.text, marginBottom: 8 },
  heatmapDays: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  heatmapDayLabel: { fontSize: 9, color: COLORS.muted },
  heatmapGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 3 },
  heatmapCell: { width: 18, height: 18, borderRadius: 3, backgroundColor: COLORS.dim },
  heatmapCellToday: { borderWidth: 1, borderColor: COLORS.accent2 },

  // Shutdown
  heroCard: { backgroundColor: 'rgba(124,92,252,0.12)', borderWidth: 1, borderColor: 'rgba(124,92,252,0.25)', borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 8 },
  heroEmoji: { fontSize: 28, marginBottom: 8 },
  heroTitle: { fontSize: 16, fontWeight: 'bold', color: COLORS.text, marginBottom: 4 },
  heroDate: { fontSize: 12, color: COLORS.muted },
  reflectionCard: { backgroundColor: COLORS.card, borderRadius: 8, padding: 10, marginBottom: 6 },
  reflectionHeader: { flexDirection: 'row', marginBottom: 4 },
  reflectionDate: { color: COLORS.accent, fontSize: 11 },
  reflectionScore: { color: COLORS.muted, fontSize: 11 },
  reflectionText: { color: COLORS.text, fontSize: 12 },

  // Common
  emptyText: { color: COLORS.muted, fontStyle: 'italic', paddingVertical: 6 },
  saveButton: { backgroundColor: COLORS.accent, padding: 12, borderRadius: 12, alignItems: 'center', marginTop: 12 },
  saveButtonText: { color: COLORS.bg, fontSize: 14, fontWeight: 'bold' },
  compactSaveButton: { backgroundColor: COLORS.accent, padding: 10, borderRadius: 12, alignItems: 'center', marginTop: 12 },
  compactSaveButtonText: { color: COLORS.bg, fontSize: 12, fontWeight: 'bold' },

  // Navigation
  navigation: { flexDirection: 'row', backgroundColor: COLORS.surface, borderTopWidth: 1, borderTopColor: COLORS.border, paddingBottom: 6 },
  navItem: { flex: 1, alignItems: 'center', paddingVertical: 8 },
  navItemActive: { borderTopWidth: 2, borderTopColor: COLORS.accent },
  navIcon: { fontSize: 18 },
  navLabel: { color: COLORS.muted, fontSize: 10, marginTop: 2 },
  navLabelActive: { color: COLORS.accent, fontWeight: 'bold' },
  navDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: COLORS.accent, marginTop: 2, shadowColor: COLORS.accent, shadowOpacity: 0.8, shadowRadius: 4, elevation: 4 },

  // Time Picker Modal
  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end', zIndex: 1000 },
  pickerSheet: { backgroundColor: COLORS.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 12, maxHeight: '80%', zIndex: 1001 },
  pickerTitle: { fontSize: 12, fontWeight: 'bold', color: COLORS.text, textAlign: 'center', marginBottom: 8 },
  pickerPreview: { backgroundColor: COLORS.card, borderRadius: 10, paddingVertical: 8, alignItems: 'center', marginBottom: 10, borderWidth: 1, borderColor: COLORS.border },
  pickerPreviewText: { fontSize: 20, fontWeight: 'bold', color: COLORS.accent2 },
  pickerSectionLabel: { fontSize: 9, color: COLORS.muted, fontWeight: '600', letterSpacing: 1, marginBottom: 6, marginTop: 4 },
  pickerGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 10 },
  pickerCell: { width: '23%', backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 6, paddingVertical: 8, alignItems: 'center', marginBottom: 4 },
  pickerCellActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  pickerCellText: { color: COLORS.text, fontSize: 12, fontWeight: '600' },
  pickerCellTextActive: { color: COLORS.bg },
  ampmRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 12 },
  ampmBtn: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 99, paddingVertical: 6, paddingHorizontal: 20 },
  ampmBtnActive: { backgroundColor: COLORS.accent, borderColor: COLORS.accent },
  ampmBtnText: { color: COLORS.muted, fontSize: 12, fontWeight: 'bold' },
  ampmBtnTextActive: { color: COLORS.bg },
  pickerActions: { flexDirection: 'row', gap: 8 },
  pickerCancelBtn: { flex: 1, backgroundColor: COLORS.card, borderRadius: 10, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  pickerCancelText: { color: COLORS.muted, fontSize: 12, fontWeight: '600' },
  pickerConfirmBtn: { flex: 1, backgroundColor: COLORS.accent, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  pickerConfirmText: { color: COLORS.bg, fontSize: 12, fontWeight: 'bold' },
  
  // Notification Diagnostics
  notifDiagCard: { backgroundColor: COLORS.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: COLORS.border, marginTop: 8 },
  notifDiagTitle: { fontSize: 12, fontWeight: 'bold', color: COLORS.text, marginBottom: 8 },
  notifDiagLine: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  notifDiagHint: { fontSize: 10, color: COLORS.muted },
  notifDiagBold: { fontSize: 10, fontWeight: 'bold', color: COLORS.accent },
  notifDiagBtn: { backgroundColor: COLORS.accent, borderRadius: 8, paddingVertical: 8, alignItems: 'center', marginTop: 8 },
  notifDiagBtnText: { color: COLORS.bg, fontSize: 11, fontWeight: 'bold' },
  notifDiagRefresh: { backgroundColor: COLORS.surface, borderRadius: 8, paddingVertical: 8, alignItems: 'center', marginTop: 6, borderWidth: 1, borderColor: COLORS.border },
  notifDiagRefreshText: { color: COLORS.muted, fontSize: 10, fontWeight: '600' },
  notifDiagTest: { backgroundColor: COLORS.green, borderRadius: 8, paddingVertical: 8, alignItems: 'center', marginTop: 6 },
  notifDiagTestText: { color: COLORS.bg, fontSize: 10, fontWeight: 'bold' },
});
