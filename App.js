import React, { useState, useEffect } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  ScrollView, 
  TouchableOpacity, 
  TextInput, 
  Switch,
  Alert,
  StatusBar,
  SafeAreaView,
  Modal
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
  A: '#ff6a6a', // High consequence
  B: '#ffd166', // Low consequence  
  C: '#7c6aff', // No consequence
  D: '#6affb0', // Delegatable
  E: '#6b6b80', // Eliminatable
  SOMEDAY: '#9b8dff',
};

export default function App() {
  const [currentDate, setCurrentDate] = useState(new Date().toISOString().split('T')[0]);
  const [tasks, setTasks] = useState({});
  const [currentPage, setCurrentPage] = useState('morning_capture');
  const [analyticsData, setAnalyticsData] = useState(null);
  
  // New methodology states
  const [brainDumpTasks, setBrainDumpTasks] = useState([]);
  const [todayTasks, setTodayTasks] = useState([]);
  const [somedayTasks, setSomedayTasks] = useState([]);
  const [currentTaskInput, setCurrentTaskInput] = useState('');
  const [showMorningCapture, setShowMorningCapture] = useState(true);
  const [showDeepWorkMode, setShowDeepWorkMode] = useState(false);
  const [deepWorkTask, setDeepWorkTask] = useState(null);
  const [deepWorkTimer, setDeepWorkTimer] = useState(4 * 60 * 60); // 4 hours in seconds
  const [isDeepWorkActive, setIsDeepWorkActive] = useState(false);
  const [showSomaticPanel, setShowSomaticPanel] = useState(false);
  const [somaticData, setSomaticData] = useState({
    chest: 3,
    breath: 3,
    heartbeat: 3,
    thoughtLabel: '',
  });
  const [showShutdown, setShowShutdown] = useState(false);
  const [shutdownReflection, setShutdownReflection] = useState('');
  const [deepWorkSessions, setDeepWorkSessions] = useState([]);
  const [somaticLogs, setSomaticLogs] = useState([]);
  const [dailyShutdowns, setDailyShutdowns] = useState([]);
  const [analyticsView, setAnalyticsView] = useState('daily'); // daily, weekly, monthly

  useEffect(() => {
    loadData();
  }, [currentDate]);

  // Deep Work Timer Effect
  useEffect(() => {
    let interval;
    if (isDeepWorkActive && deepWorkTimer > 0) {
      interval = setInterval(() => {
        setDeepWorkTimer(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            setDeepWorkSession(prev => ({ ...prev, phase: 'review' }));
            setIsDeepWorkActive(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isDeepWorkActive, deepWorkTimer]);

  const loadData = async () => {
    try {
      const savedData = await AsyncStorage.getItem('muhsanTracker_' + currentDate);
      if (savedData) {
        const parsed = JSON.parse(savedData);
        setTasks(parsed.tasks || {});
        setTodayTasks(parsed.todayTasks || []);
        setSomedayTasks(parsed.somedayTasks || []);
        setDeepWorkSessions(parsed.deepWorkSessions || []);
        setSomaticLogs(parsed.somaticLogs || []);
        setDailyShutdowns(parsed.dailyShutdowns || []);
        setShowMorningCapture(!parsed.morningCaptureCompleted);
      } else {
        setTasks({});
        setTodayTasks([]);
        setSomedayTasks([]);
        setDeepWorkSessions([]);
        setSomaticLogs([]);
        setDailyShutdowns([]);
        setShowMorningCapture(true);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    }
  };

  const saveData = async () => {
    try {
      const dataToSave = {
        tasks,
        date: currentDate,
        todayTasks,
        somedayTasks,
        deepWorkSessions,
        somaticLogs,
        dailyShutdowns,
        morningCaptureCompleted: !showMorningCapture,
      };
      await AsyncStorage.setItem('muhsanTracker_' + currentDate, JSON.stringify(dataToSave));
      Alert.alert('Success', 'Data saved successfully! Keep going, Muhsan! 🔥');
    } catch (error) {
      Alert.alert('Error', 'Failed to save data');
    }
  };

  // Morning Capture Functions
  const addBrainDumpTask = () => {
    if (currentTaskInput.trim()) {
      setBrainDumpTasks([...brainDumpTasks, { 
        id: Date.now(), 
        text: currentTaskInput,
        category: null,
        completed: false
      }]);
      setCurrentTaskInput('');
    }
  };

  const categorizeTask = (taskId, category) => {
    const task = brainDumpTasks.find(t => t.id === taskId);
    if (task) {
      // Just tag the task, don't move it
      setBrainDumpTasks(brainDumpTasks.map(t => 
        t.id === taskId ? { ...t, category } : t
      ));
    }
  };

  const toggleBrainDumpTask = (taskId) => {
    setBrainDumpTasks(brainDumpTasks.map(t => 
      t.id === taskId ? { ...t, completed: !t.completed } : t
    ));
  };

  const completeMorningCapture = () => {
    // Transfer categorized tasks to Today tab
    const categorizedTasks = brainDumpTasks.filter(t => t.category && t.category !== 'SOMEDAY');
    const somedayTasksTransfer = brainDumpTasks.filter(t => t.category === 'SOMEDAY');
    
    // Sort today tasks by priority (A -> B -> C -> D -> E)
    const priorityOrder = ['A', 'B', 'C', 'D', 'E'];
    const sortedTasks = [...categorizedTasks].sort((a, b) => {
      return priorityOrder.indexOf(a.category) - priorityOrder.indexOf(b.category);
    });
    
    setTodayTasks([...todayTasks, ...sortedTasks]);
    setSomedayTasks([...somedayTasks, ...somedayTasksTransfer]);
    setShowMorningCapture(false);
    saveData();
  };

  // Deep Work Functions
  const [deepWorkSession, setDeepWorkSession] = useState({
    goal: '',
    duration: 60, // minutes
    distractionPlan: '',
    phase: 'setup', // setup, active, review
    distractions: 0,
    startTime: null,
    endTime: null,
    notes: '',
    goalCompleted: false,
  });

  const startDeepWork = () => {
    if (!deepWorkSession.goal.trim()) {
      Alert.alert('Goal Required', 'Please set a session goal.');
      return;
    }
    setDeepWorkSession({
      ...deepWorkSession,
      phase: 'active',
      startTime: new Date().toISOString(),
      distractions: 0,
    });
    setIsDeepWorkActive(true);
    setDeepWorkTimer(deepWorkSession.duration * 60); // convert to seconds
  };

  const logDistraction = () => {
    setDeepWorkSession({
      ...deepWorkSession,
      distractions: deepWorkSession.distractions + 1,
    });
  };

  const endDeepWorkEarly = () => {
    Alert.alert(
      'End Session Early?',
      'Your session will be logged as incomplete.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'End Session', onPress: () => finishDeepWorkSession(false) }
      ]
    );
  };

  const finishDeepWorkSession = (completed = true) => {
    const session = {
      id: Date.now(),
      goal: deepWorkSession.goal,
      duration: deepWorkSession.duration,
      distractionPlan: deepWorkSession.distractionPlan,
      startTime: deepWorkSession.startTime,
      endTime: new Date().toISOString(),
      distractions: deepWorkSession.distractions,
      notes: deepWorkSession.notes,
      goalCompleted: deepWorkSession.goalCompleted,
      completed,
    };
    setDeepWorkSessions([...deepWorkSessions, session]);
    setDeepWorkSession({
      goal: '',
      duration: 60,
      distractionPlan: '',
      phase: 'setup',
      distractions: 0,
      startTime: null,
      endTime: null,
      notes: '',
      goalCompleted: false,
    });
    setIsDeepWorkActive(false);
    setShowDeepWorkMode(false);
    saveData();
  };

  // Somatic Functions
  const logSomaticState = () => {
    const log = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      chest: somaticData.chest,
      breath: somaticData.breath,
      heartbeat: somaticData.heartbeat,
      thoughtLabel: somaticData.thoughtLabel,
    };
    setSomaticLogs([...somaticLogs, log]);
    setShowSomaticPanel(false);
    setSomaticData({ chest: 3, breath: 3, heartbeat: 3, thoughtLabel: '' });
    saveData();
  };

  // Shutdown Functions
  const completeShutdown = () => {
    const shutdown = {
      id: Date.now(),
      date: currentDate,
      tasksCompleted: todayTasks.filter(t => tasks[t.id]).length,
      tasksDeferred: somedayTasks.length,
      deepWorkHours: deepWorkSessions.reduce((sum, s) => sum + s.duration, 0),
      reflection: shutdownReflection,
      shutdownTime: new Date().toISOString(),
    };
    setDailyShutdowns([...dailyShutdowns, shutdown]);
    setShowShutdown(false);
    setShutdownReflection('');
    saveData();
    Alert.alert('Shutdown Complete', 'Day logged successfully. Get some rest, Muhsan! 😴');
  };

  // Score is derived from the methodology task list (A–E / SOMEDAY).
  const calculateScore = () => {
    if (todayTasks.length === 0) return 0;
    const completed = todayTasks.filter(t => tasks[t.id]).length;
    return Math.round((completed / todayTasks.length) * 100);
  };

  const getScoreMessage = (score) => {
    if (score < 25) return 'Log your day, Muhsan 💪';
    if (score < 50) return 'Good start! Keep going 🌙';
    if (score < 75) return "You're on fire! ⚡";
    if (score < 100) return 'Almost there! 🚀';
    return 'Perfect discipline! 🏆';
  };

  const shiftDate = (days) => {
    const date = new Date(currentDate);
    date.setDate(date.getDate() + days);
    setCurrentDate(date.toISOString().split('T')[0]);
  };

  const goToToday = () => {
    setCurrentDate(new Date().toISOString().split('T')[0]);
  };

  // New rendering functions
  const renderMorningCapture = () => {
    return (
      <View style={styles.page}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Phase 1: Morning Capture</Text>
          <Text style={styles.dateLabel}>
            {new Date(currentDate).toLocaleDateString('en-US', { 
              weekday: 'long', 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            })}
          </Text>
        </View>

        <View style={styles.phaseContainer}>
          <Text style={styles.phaseSubtitle}>Step 1: Brain Dump</Text>
          <Text style={styles.phaseDescription}>
            Write ALL tasks intended for today (no filter, no judgment)
          </Text>
          
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.taskInput}
              value={currentTaskInput}
              onChangeText={setCurrentTaskInput}
              placeholder="Add a task..."
              placeholderTextColor={COLORS.muted}
            />
            <TouchableOpacity style={styles.addButton} onPress={addBrainDumpTask}>
              <Text style={styles.addButtonText}>+ Add</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.taskList}>
            {brainDumpTasks.map(task => (
              <View key={task.id} style={[styles.brainDumpTask, task.completed && styles.taskCompleted]}>
                <View style={styles.taskHeader}>
                  <TouchableOpacity onPress={() => toggleBrainDumpTask(task.id)}>
                    <View style={[
                      styles.checkbox,
                      task.completed && styles.checkboxChecked
                    ]}>
                      {task.completed && <Text style={styles.checkmark}>✓</Text>}
                    </View>
                  </TouchableOpacity>
                  <Text style={[styles.taskText, task.completed && styles.taskTextCompleted]}>
                    {task.text}
                  </Text>
                </View>
                <View style={styles.categorySection}>
                  <Text style={styles.categoryLabel}>Assign List:</Text>
                  <View style={styles.categoryButtons}>
                    {['A', 'B', 'C', 'D', 'E', 'SOMEDAY'].map(cat => (
                      <TouchableOpacity
                        key={cat}
                        style={[
                          styles.categoryButton,
                          task.category === cat && styles.categoryButtonSelected,
                          { backgroundColor: task.category === cat ? CATEGORY_COLORS[cat] : COLORS.surface }
                        ]}
                        onPress={() => categorizeTask(task.id, cat)}
                      >
                        <Text style={[
                          styles.categoryButtonText,
                          task.category === cat && styles.categoryButtonTextSelected
                        ]}>{cat}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>
            ))}
          </ScrollView>

          <View style={styles.summarySection}>
            <Text style={styles.summaryText}>
              Total: {brainDumpTasks.length} | Completed: {brainDumpTasks.filter(t => t.completed).length}
            </Text>
          </View>

          <TouchableOpacity style={styles.completeButton} onPress={completeMorningCapture}>
            <Text style={styles.completeButtonText}>Complete Morning Capture →</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderTodayPage = () => {
    const score = calculateScore();

    return (
      <View style={styles.page}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Today's Tasks</Text>
          <Text style={styles.dateLabel}>
            {new Date(currentDate).toLocaleDateString('en-US', { 
              weekday: 'long', 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            })}
          </Text>
        </View>

        <View style={styles.dateNav}>
          <TouchableOpacity style={styles.dateButton} onPress={() => shiftDate(-1)}>
            <Text style={styles.dateButtonText}>◀</Text>
          </TouchableOpacity>
          <TextInput
            style={styles.dateInput}
            value={currentDate}
            onChangeText={setCurrentDate}
            placeholder="YYYY-MM-DD"
          />
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

        <Text style={styles.todayTasksHeader}>Today's Tasks (A-B-C-D-E)</Text>
        
        <ScrollView style={styles.taskScroll}>
          {todayTasks.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No tasks yet. Complete Morning Capture first.</Text>
            </View>
          ) : (
            todayTasks.map(task => (
              <View key={task.id} style={[styles.todayTaskCard, { borderLeftColor: CATEGORY_COLORS[task.category] }]}>
                <View style={styles.taskHeader}>
                  <View style={styles.categoryBadge}>
                    <Text style={styles.categoryBadgeText}>{task.category}</Text>
                  </View>
                  <Text style={styles.taskTitle}>{task.text}</Text>
                  <TouchableOpacity onPress={() => {
                    setTasks(prev => ({ ...prev, [task.id]: !prev[task.id] }));
                  }}>
                    <View style={[
                      styles.checkbox,
                      tasks[task.id] && styles.checkboxChecked
                    ]}>
                      {tasks[task.id] && <Text style={styles.checkmark}>✓</Text>}
                    </View>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </ScrollView>

        <TouchableOpacity style={styles.saveButton} onPress={saveData}>
          <Text style={styles.saveButtonText}>Save Day</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderDeepWorkMode = () => {
    if (deepWorkSession.phase === 'setup') {
      return (
        <View style={styles.page}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Deep Work Setup</Text>
          </View>

          <View style={styles.deepWorkSetupContainer}>
            <Text style={styles.setupLabel}>Session Goal</Text>
            <TextInput
              style={styles.setupInput}
              value={deepWorkSession.goal}
              onChangeText={(text) => setDeepWorkSession({...deepWorkSession, goal: text})}
              placeholder="What will you accomplish?"
              placeholderTextColor={COLORS.muted}
            />

            <Text style={styles.setupLabel}>Duration</Text>
            <View style={styles.durationButtons}>
              {[25, 45, 60, 90].map(duration => (
                <TouchableOpacity
                  key={duration}
                  style={[
                    styles.durationButton,
                    deepWorkSession.duration === duration && styles.durationButtonSelected
                  ]}
                  onPress={() => setDeepWorkSession({...deepWorkSession, duration})}
                >
                  <Text style={[
                    styles.durationButtonText,
                    deepWorkSession.duration === duration && styles.durationButtonTextSelected
                  ]}>{duration}m</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={styles.customDurationInput}
              value={deepWorkSession.duration === 25 || deepWorkSession.duration === 45 || deepWorkSession.duration === 60 || deepWorkSession.duration === 90 ? '' : String(deepWorkSession.duration)}
              onChangeText={(text) => setDeepWorkSession({...deepWorkSession, duration: parseInt(text) || 60})}
              placeholder="Custom minutes"
              placeholderTextColor={COLORS.muted}
              keyboardType="numeric"
            />

            <Text style={styles.setupLabel}>Distraction Plan</Text>
            <TextInput
              style={styles.setupInput}
              value={deepWorkSession.distractionPlan}
              onChangeText={(text) => setDeepWorkSession({...deepWorkSession, distractionPlan: text})}
              placeholder="How will you handle distractions?"
              placeholderTextColor={COLORS.muted}
            />

            <TouchableOpacity style={styles.startDeepWorkButton} onPress={startDeepWork}>
              <Text style={styles.startDeepWorkButtonText}>Start Deep Work</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelButton} onPress={() => setShowDeepWorkMode(false)}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    } else if (deepWorkSession.phase === 'active') {
      const hours = Math.floor(deepWorkTimer / 3600);
      const minutes = Math.floor((deepWorkTimer % 3600) / 60);
      const seconds = deepWorkTimer % 60;

      return (
        <View style={styles.page}>
          <View style={styles.deepWorkActiveContainer}>
            <Text style={styles.deepWorkGoal}>{deepWorkSession.goal}</Text>
            
            <View style={styles.timerContainer}>
              <Text style={styles.timerText}>
                {String(hours).padStart(2, '0')}:{String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
              </Text>
            </View>

            <View style={styles.deepWorkStats}>
              <Text style={styles.deepWorkStat}>Distractions: {deepWorkSession.distractions}</Text>
            </View>

            <TouchableOpacity style={styles.distractionButton} onPress={logDistraction}>
              <Text style={styles.distractionButtonText}>I got distracted</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.endDeepWorkButton} onPress={endDeepWorkEarly}>
              <Text style={styles.endDeepWorkButtonText}>End Session Early</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    } else if (deepWorkSession.phase === 'review') {
      return (
        <View style={styles.page}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Session Review</Text>
          </View>

          <View style={styles.sessionReviewContainer}>
            <Text style={styles.reviewLabel}>Goal: {deepWorkSession.goal}</Text>
            <Text style={styles.reviewLabel}>Distractions: {deepWorkSession.distractions}</Text>
            
            <View style={styles.reviewRow}>
              <Text style={styles.reviewLabel}>Goal Completed?</Text>
              <Switch
                value={deepWorkSession.goalCompleted}
                onValueChange={(value) => setDeepWorkSession({...deepWorkSession, goalCompleted: value})}
              />
            </View>

            <Text style={styles.reviewLabel}>Notes</Text>
            <TextInput
              style={styles.reviewInput}
              value={deepWorkSession.notes}
              onChangeText={(text) => setDeepWorkSession({...deepWorkSession, notes: text})}
              placeholder="Session notes..."
              placeholderTextColor={COLORS.muted}
              multiline
              numberOfLines={4}
            />

            <TouchableOpacity style={styles.saveSessionButton} onPress={() => finishDeepWorkSession(true)}>
              <Text style={styles.saveSessionButtonText}>Save Session</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }
  };

  const renderSomaticPanel = () => {
    return (
      <Modal visible={showSomaticPanel} animationType="slide">
        <View style={styles.somaticPanel}>
          <View style={styles.somaticHeader}>
            <Text style={styles.somaticTitle}>Somatic Awareness</Text>
            <TouchableOpacity onPress={() => setShowSomaticPanel(false)}>
              <Text style={styles.closeButton}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.somaticSection}>
            <Text style={styles.somaticLabel}>Chest Sensation (1-5)</Text>
            <TextInput
              style={styles.somaticInput}
              value={String(somaticData.chest)}
              onChangeText={(text) => setSomaticData({...somaticData, chest: parseInt(text) || 3})}
              keyboardType="numeric"
              placeholder="3"
              placeholderTextColor={COLORS.muted}
            />
          </View>

          <View style={styles.somaticSection}>
            <Text style={styles.somaticLabel}>Breath Speed (1-5)</Text>
            <TextInput
              style={styles.somaticInput}
              value={String(somaticData.breath)}
              onChangeText={(text) => setSomaticData({...somaticData, breath: parseInt(text) || 3})}
              keyboardType="numeric"
              placeholder="3"
              placeholderTextColor={COLORS.muted}
            />
          </View>

          <View style={styles.somaticSection}>
            <Text style={styles.somaticLabel}>Heartbeat (1-5)</Text>
            <TextInput
              style={styles.somaticInput}
              value={String(somaticData.heartbeat)}
              onChangeText={(text) => setSomaticData({...somaticData, heartbeat: parseInt(text) || 3})}
              keyboardType="numeric"
              placeholder="3"
              placeholderTextColor={COLORS.muted}
            />
          </View>

          <View style={styles.somaticSection}>
            <Text style={styles.somaticLabel}>Thought Label</Text>
            <TextInput
              style={styles.somaticInput}
              value={somaticData.thoughtLabel}
              onChangeText={(text) => setSomaticData({...somaticData, thoughtLabel: text})}
              placeholder="Label the thought (anxiety, fear, etc.)"
              placeholderTextColor={COLORS.muted}
            />
          </View>

          <TouchableOpacity style={styles.logSomaticButton} onPress={logSomaticState}>
            <Text style={styles.logSomaticButtonText}>Log State</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    );
  };

  const renderShutdownRitual = () => {
    const todayCompleted = todayTasks.filter(t => tasks[t.id]).length;
    const totalDeepWork = deepWorkSessions.reduce((sum, s) => sum + s.duration, 0);

    return (
      <Modal visible={showShutdown} animationType="slide">
        <View style={styles.shutdownPanel}>
          <View style={styles.shutdownHeader}>
            <Text style={styles.shutdownTitle}>Phase 6: Shutdown Ritual</Text>
            <TouchableOpacity onPress={() => setShowShutdown(false)}>
              <Text style={styles.closeButton}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.shutdownContent}>
            <Text style={styles.shutdownSectionTitle}>Today's Review</Text>
            <Text style={styles.shutdownStat}>Tasks Completed: {todayCompleted}/{todayTasks.length}</Text>
            <Text style={styles.shutdownStat}>Deep Work Hours: {totalDeepWork.toFixed(1)}h</Text>
            <Text style={styles.shutdownStat}>Tasks Deferred: {somedayTasks.length}</Text>

            <Text style={styles.shutdownSectionTitle}>Reflection</Text>
            <TextInput
              style={styles.shutdownInput}
              value={shutdownReflection}
              onChangeText={setShutdownReflection}
              placeholder="How did today go? What did you accomplish?"
              placeholderTextColor={COLORS.muted}
              multiline
              numberOfLines={4}
            />

            <TouchableOpacity style={styles.shutdownButton} onPress={completeShutdown}>
              <Text style={styles.shutdownButtonText}>SHUTDOWN</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  };

  const renderAnalytics = () => {
    return (
      <View style={styles.page}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Analytics Dashboard</Text>
        </View>

        <View style={styles.analyticsTabs}>
          <TouchableOpacity
            style={[styles.analyticsTab, analyticsView === 'daily' && styles.analyticsTabActive]}
            onPress={() => setAnalyticsView('daily')}
          >
            <Text style={[styles.analyticsTabText, analyticsView === 'daily' && styles.analyticsTabTextActive]}>Daily</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.analyticsTab, analyticsView === 'weekly' && styles.analyticsTabActive]}
            onPress={() => setAnalyticsView('weekly')}
          >
            <Text style={[styles.analyticsTabText, analyticsView === 'weekly' && styles.analyticsTabTextActive]}>Weekly</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.analyticsTab, analyticsView === 'monthly' && styles.analyticsTabActive]}
            onPress={() => setAnalyticsView('monthly')}
          >
            <Text style={[styles.analyticsTabText, analyticsView === 'monthly' && styles.analyticsTabTextActive]}>Monthly</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.analyticsScroll}>
          {analyticsView === 'daily' && (
            <View style={styles.analyticsCard}>
              <Text style={styles.analyticsTitle}>Daily Overview - {currentDate}</Text>
              <Text style={styles.analyticsStat}>Tasks Scheduled: {todayTasks.length}</Text>
              <Text style={styles.analyticsStat}>Tasks Completed: {todayTasks.filter(t => tasks[t.id]).length}</Text>
              <Text style={styles.analyticsStat}>Tasks Pending: {todayTasks.filter(t => !tasks[t.id]).length}</Text>
              <Text style={styles.analyticsStat}>Deep Work Sessions: {deepWorkSessions.length}</Text>
              <Text style={styles.analyticsStat}>Deep Work Minutes: {deepWorkSessions.reduce((sum, s) => sum + s.duration, 0)}</Text>
              <Text style={styles.analyticsStat}>Score: {calculateScore()}%</Text>
              <Text style={styles.analyticsStat}>Completion Rate: {todayTasks.length > 0 ? Math.round((todayTasks.filter(t => tasks[t.id]).length / todayTasks.length) * 100) : 0}%</Text>
            </View>
          )}

          {analyticsView === 'weekly' && (
            <View style={styles.analyticsCard}>
              <Text style={styles.analyticsTitle}>Weekly Overview</Text>
              <Text style={styles.analyticsStat}>This Week's Deep Work: {deepWorkSessions.length} sessions</Text>
              <Text style={styles.analyticsStat}>This Week's Deep Work Hours: {(deepWorkSessions.reduce((sum, s) => sum + s.duration, 0) / 60).toFixed(1)}h</Text>
              <Text style={styles.analyticsStat}>Someday Tasks: {somedayTasks.length}</Text>
              <Text style={styles.analyticsStat}>Total Tasks This Week: {todayTasks.length}</Text>
              <Text style={styles.analyticsStat}>Tasks Completed: {todayTasks.filter(t => tasks[t.id]).length}</Text>
              <Text style={styles.analyticsStat}>Weekly Completion Rate: {todayTasks.length > 0 ? Math.round((todayTasks.filter(t => tasks[t.id]).length / todayTasks.length) * 100) : 0}%</Text>
            </View>
          )}

          {analyticsView === 'monthly' && (
            <View style={styles.analyticsCard}>
              <Text style={styles.analyticsTitle}>Monthly Overview</Text>
              <Text style={styles.analyticsStat}>Total Deep Work Sessions: {deepWorkSessions.length}</Text>
              <Text style={styles.analyticsStat}>Total Deep Work Hours: {(deepWorkSessions.reduce((sum, s) => sum + s.duration, 0) / 60).toFixed(1)}h</Text>
              <Text style={styles.analyticsStat}>Someday Tasks: {somedayTasks.length}</Text>
              <Text style={styles.analyticsStat}>Total Tasks: {todayTasks.length}</Text>
              <Text style={styles.analyticsStat}>Tasks Completed: {todayTasks.filter(t => tasks[t.id]).length}</Text>
              <Text style={styles.analyticsStat}>Overall Completion Rate: {todayTasks.length > 0 ? Math.round((todayTasks.filter(t => tasks[t.id]).length / todayTasks.length) * 100) : 0}%</Text>
            </View>
          )}

          <View style={styles.analyticsCard}>
            <Text style={styles.analyticsTitle}>Someday Bucket</Text>
            {somedayTasks.length === 0 ? (
              <Text style={styles.emptyText}>No deferred tasks</Text>
            ) : (
              somedayTasks.map(task => (
                <View key={task.id} style={styles.somedayTask}>
                  <Text style={styles.somedayTaskText}>{task.text}</Text>
                  <TouchableOpacity
                    style={styles.promoteButton}
                    onPress={() => {
                      setTodayTasks([...todayTasks, { ...task, category: 'B' }]);
                      setSomedayTasks(somedayTasks.filter(t => t.id !== task.id));
                      saveData();
                    }}
                  >
                    <Text style={styles.promoteButtonText}>Promote to Today</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>

          <View style={styles.analyticsCard}>
            <Text style={styles.analyticsTitle}>Deep Work Sessions</Text>
            {deepWorkSessions.length === 0 ? (
              <Text style={styles.emptyText}>No deep work sessions</Text>
            ) : (
              deepWorkSessions.map(session => (
                <View key={session.id} style={styles.sessionItem}>
                  <Text style={styles.sessionTask}>{session.goal}</Text>
                  <Text style={styles.sessionDuration}>{session.duration}m</Text>
                  <Text style={styles.sessionStatus}>
                    {session.completed ? '✓ Completed' : '✗ Incomplete'}
                  </Text>
                  <Text style={styles.sessionDistractions}>Distractions: {session.distractions}</Text>
                </View>
              ))
            )}
          </View>
        </ScrollView>
      </View>
    );
  };

  const renderNavigation = () => {
    const pages = [
      { id: 'morning_capture', label: '🌅 Morning', icon: '🌅' },
      { id: 'today', label: '📋 Today', icon: '📋' },
      { id: 'deep_work', label: '🎯 Deep Work', icon: '🎯' },
      { id: 'analytics', label: '📊 Analytics', icon: '📊' },
      { id: 'shutdown', label: '😴 Shutdown', icon: '😴' },
    ];

    return (
      <View style={styles.navigation}>
        {pages.map(page => (
          <TouchableOpacity
            key={page.id}
            style={[
              styles.navItem,
              currentPage === page.id && styles.navItemActive
            ]}
            onPress={() => {
              if (page.id === 'deep_work') {
                const aTasks = todayTasks.filter(t => t.category === 'A');
                if (aTasks.length > 0) {
                  setDeepWorkTask(aTasks[0]);
                  setShowDeepWorkMode(true);
                } else {
                  Alert.alert('No A-Tasks', 'Complete morning capture and categorize tasks first.');
                }
              } else if (page.id === 'shutdown') {
                setShowShutdown(true);
              } else {
                setCurrentPage(page.id);
              }
            }}
          >
            <Text style={styles.navIcon}>{page.icon}</Text>
            <Text style={[
              styles.navLabel,
              currentPage === page.id && styles.navLabelActive
            ]}>{page.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  const renderSomaticButton = () => {
    return (
      <TouchableOpacity
        style={styles.somaticFloatingButton}
        onPress={() => setShowSomaticPanel(true)}
      >
        <Text style={styles.somaticFloatingButtonText}>🧠</Text>
      </TouchableOpacity>
    );
  };

  const renderPage = () => {
    switch (currentPage) {
      case 'morning_capture':
        return showMorningCapture ? renderMorningCapture() : renderTodayPage();
      case 'today':
        return renderTodayPage();
      case 'analytics':
        return renderAnalytics();
      default:
        return renderTodayPage();
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
      {renderPage()}
      {renderNavigation()}
      {renderSomaticButton()}
      {showDeepWorkMode && renderDeepWorkMode()}
      {renderSomaticPanel()}
      {renderShutdownRitual()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  page: {
    flex: 1,
    padding: 16,
  },
  sectionHeader: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 4,
  },
  dateLabel: {
    fontSize: 14,
    color: COLORS.muted,
  },
  dateNav: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  dateButton: {
    padding: 8,
    backgroundColor: COLORS.card,
    borderRadius: 8,
  },
  dateButtonText: {
    color: COLORS.text,
    fontSize: 18,
  },
  dateInput: {
    flex: 1,
    marginHorizontal: 8,
    padding: 8,
    backgroundColor: COLORS.card,
    borderRadius: 8,
    color: COLORS.text,
    textAlign: 'center',
  },
  todayButton: {
    padding: 8,
    backgroundColor: COLORS.accent,
    borderRadius: 8,
  },
  todayButtonText: {
    color: COLORS.text,
    fontSize: 14,
  },
  scoreContainer: {
    backgroundColor: COLORS.card,
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    alignItems: 'center',
  },
  scoreText: {
    fontSize: 48,
    fontWeight: 'bold',
    color: COLORS.accent,
  },
  scoreMessage: {
    fontSize: 16,
    color: COLORS.text,
    marginTop: 8,
  },
  taskScroll: {
    flex: 1,
  },
  taskCard: {
    backgroundColor: COLORS.card,
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderLeftWidth: 4,
  },
  taskHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  taskIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  taskInfo: {
    flex: 1,
  },
  taskTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  taskTime: {
    fontSize: 12,
    color: COLORS.muted,
  },
  taskDesc: {
    fontSize: 14,
    color: COLORS.muted,
    marginBottom: 8,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },
  checkmark: {
    color: COLORS.bg,
    fontWeight: 'bold',
  },
  saveButton: {
    backgroundColor: COLORS.accent,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  saveButtonText: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  // Morning Capture Styles
  phaseContainer: {
    flex: 1,
  },
  phaseSubtitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 8,
  },
  phaseDescription: {
    fontSize: 14,
    color: COLORS.muted,
    marginBottom: 16,
  },
  inputContainer: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  taskInput: {
    flex: 1,
    backgroundColor: COLORS.card,
    padding: 12,
    borderRadius: 8,
    color: COLORS.text,
    marginRight: 8,
  },
  addButton: {
    backgroundColor: COLORS.accent,
    padding: 12,
    borderRadius: 8,
  },
  addButtonText: {
    color: COLORS.text,
    fontWeight: 'bold',
  },
  taskList: {
    flex: 1,
  },
  brainDumpTask: {
    backgroundColor: COLORS.card,
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  taskCompleted: {
    opacity: 0.5,
  },
  taskHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  taskText: {
    color: COLORS.text,
    fontSize: 16,
    flex: 1,
  },
  taskTextCompleted: {
    textDecorationLine: 'line-through',
    color: COLORS.muted,
  },
  categorySection: {
    marginTop: 8,
  },
  categoryLabel: {
    fontSize: 12,
    color: COLORS.muted,
    marginBottom: 4,
  },
  categoryButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  categoryButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
    marginBottom: 8,
  },
  categoryButtonSelected: {
    borderWidth: 2,
    borderColor: COLORS.text,
  },
  categoryButtonText: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: 'bold',
  },
  categoryButtonTextSelected: {
    color: COLORS.bg,
  },
  summarySection: {
    backgroundColor: COLORS.card,
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  summaryText: {
    color: COLORS.text,
    fontSize: 14,
  },
  completeButton: {
    backgroundColor: COLORS.accent3,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  completeButtonText: {
    color: COLORS.bg,
    fontSize: 16,
    fontWeight: 'bold',
  },
  // Today Page Styles
  todayTasksHeader: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 16,
  },
  todayTaskCard: {
    backgroundColor: COLORS.card,
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderLeftWidth: 4,
  },
  categoryBadge: {
    backgroundColor: COLORS.accent,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginRight: 8,
  },
  categoryBadgeText: {
    color: COLORS.bg,
    fontSize: 12,
    fontWeight: 'bold',
  },
  emptyState: {
    backgroundColor: COLORS.card,
    padding: 32,
    borderRadius: 12,
    alignItems: 'center',
  },
  emptyText: {
    color: COLORS.muted,
    fontSize: 16,
    textAlign: 'center',
  },
  // Deep Work Styles
  deepWorkSetupContainer: {
    flex: 1,
    padding: 16,
  },
  setupLabel: {
    fontSize: 16,
    color: COLORS.text,
    marginBottom: 8,
    marginTop: 16,
  },
  setupInput: {
    backgroundColor: COLORS.card,
    padding: 12,
    borderRadius: 8,
    color: COLORS.text,
    marginBottom: 16,
  },
  durationButtons: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  durationButton: {
    flex: 1,
    padding: 12,
    backgroundColor: COLORS.card,
    borderRadius: 8,
    marginHorizontal: 4,
    alignItems: 'center',
  },
  durationButtonSelected: {
    backgroundColor: COLORS.accent,
  },
  durationButtonText: {
    color: COLORS.text,
    fontSize: 14,
  },
  durationButtonTextSelected: {
    color: COLORS.bg,
    fontWeight: 'bold',
  },
  customDurationInput: {
    backgroundColor: COLORS.card,
    padding: 12,
    borderRadius: 8,
    color: COLORS.text,
    marginBottom: 16,
  },
  deepWorkActiveContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  deepWorkGoal: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 32,
  },
  deepWorkStats: {
    marginBottom: 32,
  },
  deepWorkStat: {
    fontSize: 18,
    color: COLORS.muted,
    marginBottom: 8,
  },
  distractionButton: {
    backgroundColor: COLORS.accent2,
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  distractionButtonText: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  endDeepWorkButton: {
    backgroundColor: COLORS.card,
    padding: 16,
    borderRadius: 12,
  },
  endDeepWorkButtonText: {
    color: COLORS.muted,
    fontSize: 16,
  },
  sessionReviewContainer: {
    flex: 1,
    padding: 16,
  },
  reviewLabel: {
    fontSize: 16,
    color: COLORS.text,
    marginBottom: 8,
  },
  reviewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  reviewInput: {
    backgroundColor: COLORS.card,
    padding: 12,
    borderRadius: 8,
    color: COLORS.text,
    marginBottom: 16,
  },
  saveSessionButton: {
    backgroundColor: COLORS.accent3,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  saveSessionButtonText: {
    color: COLORS.bg,
    fontSize: 16,
    fontWeight: 'bold',
  },
  // Somatic Panel Styles
  somaticPanel: {
    flex: 1,
    backgroundColor: COLORS.bg,
    padding: 16,
  },
  somaticHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  somaticTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  closeButton: {
    fontSize: 24,
    color: COLORS.muted,
  },
  somaticSection: {
    marginBottom: 24,
  },
  somaticLabel: {
    fontSize: 16,
    color: COLORS.text,
    marginBottom: 8,
  },
  somaticInput: {
    backgroundColor: COLORS.card,
    padding: 12,
    borderRadius: 8,
    color: COLORS.text,
    marginBottom: 16,
  },
  logSomaticButton: {
    backgroundColor: COLORS.accent,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  logSomaticButtonText: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  // Shutdown Panel Styles
  shutdownPanel: {
    flex: 1,
    backgroundColor: COLORS.bg,
    padding: 16,
  },
  shutdownHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  shutdownTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  shutdownContent: {
    flex: 1,
  },
  shutdownSectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 12,
  },
  shutdownStat: {
    fontSize: 16,
    color: COLORS.text,
    marginBottom: 8,
  },
  shutdownInput: {
    backgroundColor: COLORS.card,
    padding: 12,
    borderRadius: 8,
    color: COLORS.text,
    marginBottom: 16,
    minHeight: 100,
  },
  shutdownButton: {
    backgroundColor: COLORS.accent3,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  shutdownButtonText: {
    color: COLORS.bg,
    fontSize: 18,
    fontWeight: 'bold',
  },
  // Analytics Styles
  analyticsTabs: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  analyticsTab: {
    flex: 1,
    padding: 12,
    backgroundColor: COLORS.card,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  analyticsTabActive: {
    backgroundColor: COLORS.accent,
  },
  analyticsTabText: {
    color: COLORS.muted,
    fontSize: 14,
  },
  analyticsTabTextActive: {
    color: COLORS.bg,
    fontWeight: 'bold',
  },
  analyticsScroll: {
    flex: 1,
  },
  analyticsCard: {
    backgroundColor: COLORS.card,
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  analyticsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 12,
  },
  analyticsStat: {
    fontSize: 14,
    color: COLORS.text,
    marginBottom: 4,
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.muted,
    fontStyle: 'italic',
  },
  somedayTask: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  somedayTaskText: {
    flex: 1,
    color: COLORS.text,
  },
  promoteButton: {
    backgroundColor: COLORS.accent,
    padding: 8,
    borderRadius: 8,
  },
  promoteButtonText: {
    color: COLORS.text,
    fontSize: 12,
  },
  sessionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sessionTask: {
    flex: 1,
    color: COLORS.text,
  },
  sessionDuration: {
    color: COLORS.accent,
  },
  sessionStatus: {
    color: COLORS.text,
  },
  sessionDistractions: {
    color: COLORS.muted,
    fontSize: 12,
  },
  // Navigation Styles
  navigation: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
  },
  navItemActive: {
    backgroundColor: COLORS.card,
    borderRadius: 8,
  },
  navIcon: {
    fontSize: 20,
    marginBottom: 4,
  },
  navLabel: {
    fontSize: 10,
    color: COLORS.muted,
  },
  navLabelActive: {
    color: COLORS.text,
  },
  // Floating Button
  somaticFloatingButton: {
    position: 'absolute',
    bottom: 80,
    right: 16,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
  },
  somaticFloatingButtonText: {
    fontSize: 24,
  },
});