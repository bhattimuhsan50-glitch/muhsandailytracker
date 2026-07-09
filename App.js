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
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  setupNotifications,
  scheduleBreathReminder,
  cancelBreathReminder,
} from './notifications';

const COLORS = {
  bg: '#0a0a0f',
  surface: '#111118',
  card: '#16161f',
  border: '#1e1e2e',
  accent: '#7c6aff',
  accent2: '#ff6a6a',
  accent3: '#6affb0',
  text: '#e8e8f0',
  muted: '#6b6b80',
  gold: '#ffd166',
};

const CATEGORY_COLORS = {
  A: '#ff6a6a',
  B: '#ffd166',
  C: '#7c6aff',
  D: '#6affb0',
  E: '#6b6b80',
};

// The seven life domains shared across Goals and Today tabs.
const LIFE_DOMAINS = [
  'Career',
  'Money',
  'Family',
  'Friends',
  'Fun',
  'Health',
  'Personal Growth',
];

const PRIORITY_ORDER = ['A', 'B', 'C', 'D', 'E'];

const defaultGoals = () => {
  const g = {};
  LIFE_DOMAINS.forEach((d) => { g[d] = { goalText: '', progress: 0 }; });
  return g;
};

const STORAGE_KEY = (date) => 'muhsanTracker_' + date;

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
      } else {
        setTasks({});
        setGoals(defaultGoals());
        setTodayTasks([]);
        setSomaticLogs([]);
        setDailyShutdowns([]);
        setTaskReminders({});
      }
    } catch (error) {
      console.error('Error loading data:', error);
    }
  };

  const loadReminderInterval = async () => {
    try {
      const interval = await AsyncStorage.getItem('reminderInterval');
      if (interval) {
        setReminderInterval(parseInt(interval));
      }
    } catch (error) {
      console.error('Error loading reminder interval:', error);
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
    const next = Math.max(0, Math.min(100, (goals[domain].progress || 0) + delta));
    setGoals({ ...goals, [domain]: { ...goals[domain], progress: next } });
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
  const deleteTask = (taskId) => {
    setTodayTasks(todayTasks.filter((t) => t.id !== taskId));
    // Also clean up reminder
    const newReminders = { ...taskReminders };
    delete newReminders[taskId];
    setTaskReminders(newReminders);
  };
  const setTaskCategory = (taskId, category) => {
    setTodayTasks(todayTasks.map((t) => (t.id === taskId ? { ...t, category } : t)));
  };
  const setTaskReminder = (taskId, time) => {
    setTaskReminders({ ...taskReminders, [taskId]: time });
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
    saveData(true);
  };

  // ─── Shutdown ─────────────────────────────────────────────────────────────
  const completeShutdown = () => {
    const shutdown = {
      id: Date.now(),
      date: currentDate,
      reflection: shutdownReflection,
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
      <ScrollView style={styles.scroll}>
        {LIFE_DOMAINS.map((domain) => (
          <View key={domain} style={styles.card}>
            <Text style={styles.cardTitle}>{domain}</Text>
            <TextInput
              style={styles.input}
              value={goals[domain]?.goalText || ''}
              onChangeText={(t) => updateGoalText(domain, t)}
              placeholder={`Long-term goal for ${domain}...`}
              placeholderTextColor={COLORS.muted}
              multiline
            />
            <View style={styles.progressRow}>
              <TouchableOpacity style={styles.stepBtn} onPress={() => updateGoalProgress(domain, -10)}>
                <Text style={styles.stepBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.progressText}>{goals[domain]?.progress || 0}%</Text>
              <TouchableOpacity style={styles.stepBtn} onPress={() => updateGoalProgress(domain, 10)}>
                <Text style={styles.stepBtnText}>+</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.progressBar}>
              <View style={[styles.progressBarFill, { width: `${goals[domain]?.progress || 0}%` }]} />
            </View>
          </View>
        ))}
        <TouchableOpacity style={styles.saveButton} onPress={() => saveData()}>
          <Text style={styles.saveButtonText}>Save Goals</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );

  // ─── Render: Today ────────────────────────────────────────────────────────
  const renderTodayPage = () => {
    const score = calculateScore();
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
          <Text style={styles.scoreText}>{score}%</Text>
          <Text style={styles.scoreMessage}>{getScoreMessage(score)}</Text>
        </View>
        <ScrollView style={styles.scroll}>
          {LIFE_DOMAINS.map((domain) => {
            const list = sortedTasks(domain);
            return (
              <View key={domain} style={styles.card}>
                <Text style={styles.cardTitle}>{domain}</Text>
                <View style={styles.inputRow}>
                  <TextInput
                    style={styles.input}
                    value={domainInputs[domain] || ''}
                    onChangeText={(t) => setDomainInputs({ ...domainInputs, [domain]: t })}
                    placeholder={`Add a ${domain} task...`}
                    placeholderTextColor={COLORS.muted}
                  />
                  <TouchableOpacity style={styles.addBtn} onPress={() => addDomainTask(domain)}>
                    <Text style={styles.addBtnText}>+</Text>
                  </TouchableOpacity>
                </View>
                {list.length === 0 ? (
                  <Text style={styles.emptyText}>No tasks.</Text>
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
                    {list.map((task) => (
                      <View key={task.id} style={styles.reminderRow}>
                        <Text style={styles.reminderTaskText} numberOfLines={1}>{task.text}</Text>
                        <TextInput
                          style={styles.reminderInput}
                          value={taskReminders[task.id] || ''}
                          onChangeText={(t) => setTaskReminder(task.id, t)}
                          placeholder="HH:MM"
                          placeholderTextColor={COLORS.muted}
                        />
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
          <TouchableOpacity style={styles.saveButton} onPress={() => saveData()}>
            <Text style={styles.saveButtonText}>Save Day</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  };

  // ─── Render: Analytics ────────────────────────────────────────────────────
  const domainStats = () => LIFE_DOMAINS.map((domain) => {
    const list = todayTasks.filter((t) => t.domain === domain);
    const done = list.filter((t) => tasks[t.id]).length;
    return { domain, total: list.length, done, rate: list.length ? Math.round((done / list.length) * 100) : 0 };
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

  const renderAnalytics = () => (
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
            <Text style={styles.statValue}>{todayTasks.filter((t) => tasks[t.id]).length}</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Completion Rate</Text>
            <Text style={styles.statValue}>{calculateScore()}%</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );

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
        <View style={styles.techniqueRow}>
          {['Present Past Game', 'Opportunity Game'].map((tech) => (
            <TouchableOpacity
              key={tech}
              style={[styles.techniqueBtn, somaticData.technique === tech && styles.techniqueBtnActive]}
              onPress={() => setSomaticData({ ...somaticData, technique: tech })}
            >
              <Text style={[styles.techniqueBtnText, somaticData.technique === tech && styles.techniqueBtnTextActive]}>{tech}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={styles.saveButton} onPress={logSomaticState}>
          <Text style={styles.saveButtonText}>Save / Submit</Text>
        </TouchableOpacity>

        <Text style={styles.historyTitle}>Today's Sessions</Text>
        {somaticLogs.length === 0 ? (
          <Text style={styles.emptyText}>No entries yet.</Text>
        ) : (
          somaticLogs.slice().reverse().map((log) => (
            <View key={log.id} style={styles.historyItem}>
              <Text style={styles.historyDate}>
                {new Date(log.timestamp).toLocaleString()} · Focus {log.focusLevel || '—'}%
              </Text>
              {log.thoughts ? <Text style={styles.historyText}>Thoughts: {log.thoughts}</Text> : null}
              {log.thoughtLabel ? <Text style={styles.historyText}>Label: {log.thoughtLabel}</Text> : null}
              {log.technique ? <Text style={styles.historyText}>Technique: {log.technique}</Text> : null}
            </View>
          ))
        )}

        <View style={styles.divider} />
        <Text style={styles.promptText}>Breath Reminder</Text>
        <View style={styles.techniqueRow}>
          {[{ label: 'Off', h: 0 }, { label: '1h', h: 1 }, { label: '2h', h: 2 }, { label: '4h', h: 4 }].map((opt) => (
            <TouchableOpacity
              key={opt.label}
              style={[styles.techniqueBtn, reminderInterval === opt.h && styles.techniqueBtnActive]}
              onPress={() => changeReminder(opt.h)}
            >
              <Text style={[styles.techniqueBtnText, reminderInterval === opt.h && styles.techniqueBtnTextActive]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );

  // ─── Render: Shutdown ─────────────────────────────────────────────────────
  const renderShutdownPage = () => (
    <View style={styles.page}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Shutdown Ritual</Text>
      </View>
      <ScrollView style={styles.scroll}>
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

        <Text style={styles.historyTitle}>Past Reflections</Text>
        {dailyShutdowns.length === 0 ? (
          <Text style={styles.emptyText}>No past reflections.</Text>
        ) : (
          dailyShutdowns.slice().reverse().map((s) => (
            <View key={s.id} style={styles.historyItem}>
              <Text style={styles.historyDate}>{s.date}</Text>
              <Text style={styles.historyText}>{s.reflection || '(no reflection written)'}</Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );

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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  page: { flex: 1, padding: 12 },
  sectionHeader: { marginBottom: 8 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: COLORS.text },
  dateLabel: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  scroll: { flex: 1 },

  // Cards / inputs
  card: { backgroundColor: COLORS.card, padding: 12, borderRadius: 12, marginBottom: 8 },
  cardTitle: { fontSize: 14, fontWeight: 'bold', color: COLORS.text, marginBottom: 6 },
  input: { backgroundColor: COLORS.surface, borderRadius: 8, padding: 8, color: COLORS.text, borderWidth: 1, borderColor: COLORS.border, minHeight: 36 },
  inputRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  addBtn: { backgroundColor: COLORS.accent, borderRadius: 8, marginLeft: 6, paddingHorizontal: 12, paddingVertical: 10 },
  addBtnText: { color: COLORS.bg, fontWeight: 'bold', fontSize: 16 },

  // Progress
  progressRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  stepBtn: { backgroundColor: COLORS.surface, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, marginHorizontal: 8 },
  stepBtnText: { color: COLORS.text, fontSize: 18, fontWeight: 'bold' },
  progressText: { color: COLORS.accent, fontSize: 16, fontWeight: 'bold', minWidth: 50, textAlign: 'center' },
  progressBar: { height: 6, backgroundColor: COLORS.border, borderRadius: 3, marginTop: 6, overflow: 'hidden' },
  progressBarFill: { height: 6, backgroundColor: COLORS.accent3 },

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
  reminderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  reminderTaskText: { flex: 1, color: COLORS.text, fontSize: 12, marginRight: 8 },
  reminderInput: { backgroundColor: COLORS.card, borderRadius: 6, padding: 6, color: COLORS.text, fontSize: 12, width: 80, borderWidth: 1, borderColor: COLORS.border },

  // Somatic
  question: { fontSize: 16, fontWeight: 'bold', color: COLORS.text, marginBottom: 12, textAlign: 'center' },
  promptText: { fontSize: 12, color: COLORS.muted, marginTop: 12, marginBottom: 6 },
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
  chartCard: { backgroundColor: COLORS.card, padding: 12, borderRadius: 12, marginBottom: 8 },
  chartTitle: { fontSize: 14, fontWeight: 'bold', color: COLORS.text, marginBottom: 8 },
  chartContainer: { backgroundColor: COLORS.surface, padding: 8, borderRadius: 8 },
  chartRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  chartLabel: { width: 80, color: COLORS.text, fontSize: 12 },
  chartBarBackground: { flex: 1, height: 8, backgroundColor: COLORS.border, borderRadius: 4, marginHorizontal: 8 },
  chartBarFill: { height: 8, backgroundColor: COLORS.accent3, borderRadius: 4 },
  chartValue: { width: 40, color: COLORS.text, fontSize: 12, textAlign: 'right' },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  statLabel: { color: COLORS.text, flex: 1, fontSize: 12 },
  statValue: { color: COLORS.muted, fontSize: 12 },

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
});
