import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView
} from 'react-native-safe-area-context';
import { saveDownload } from './saveDownload';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import * as Speech from 'expo-speech';
import RemoteControls from './RemoteControls';

const C = {
  bg: '#101310',
  card: '#1b201b',
  raised: '#252c24',
  line: '#333c31',
  text: '#f1f4eb',
  muted: '#a4ae9e',
  lime: '#d0f58a',
  ink: '#243416',
  red: '#ffb4a7'
};

const tabs = [
  ['Home', 'grid-outline'],
  ['Files', 'folder-outline'],
  ['Apps', 'apps-outline'],
  ['Modes', 'layers-outline'],
  ['Assistant', 'sparkles-outline']
];

const media = [
  ['volume-low-outline', 'volumeDown', 'Volume down'],
  ['volume-high-outline', 'volumeUp', 'Volume up'],
  ['volume-mute-outline', 'mute', 'Toggle mute'],
  ['play-skip-back-outline', 'previousTrack', 'Previous track'],
  ['play-outline', 'playPause', 'Play or pause'],
  ['play-skip-forward-outline', 'nextTrack', 'Next track']
];

const welcome = {
  role: 'assistant',
  content:
    'Hello! I’m your laptop companion. Ask about your battery, open an app, or start a mode.'
};

const gb = n =>
  `${((Number(n) || 0) / 1024 ** 3).toFixed(1)} GB`;

const params = obj =>
  Object.entries(obj)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

async function request(connection, route, data, signal) {
  if (!connection) {
    throw new Error('Connect your laptop first.');
  }

  const controller = new AbortController();
  const timeout = signal
    ? null
    : setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(connection.url + route, {
      method: data === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${connection.token}`,
        'Content-Type': 'application/json'
      },
      ...(data === undefined
        ? {}
        : { body: JSON.stringify(data) }),
      signal: signal || controller.signal
    });

    const result = await response.json();

    if (!response.ok) {
      throw Object.assign(
        new Error(result.error || 'Request failed.'),
        { status: response.status }
      );
    }

    return result;
  } finally {
    clearTimeout(timeout);
  }
}

function Icon({ name, size = 22, color = C.text }) {
  return <Ionicons name={name} size={size} color={color} />;
}

function Button({
  title,
  icon,
  onPress,
  disabled,
  soft = false
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.button,
        soft && { backgroundColor: C.raised },
        (disabled || pressed) && { opacity: 0.5 }
      ]}
    >
      {icon && (
        <Icon
          name={icon}
          size={18}
          color={soft ? C.text : C.ink}
        />
      )}
      <Text
        style={[
          s.buttonText,
          soft && { color: C.text }
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

function Round({
  icon,
  label,
  onPress,
  disabled,
  active
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.round,
        active && { backgroundColor: C.lime },
        (disabled || pressed) && { opacity: 0.4 }
      ]}
    >
      <Icon
        name={icon}
        color={active ? C.ink : C.text}
      />
    </Pressable>
  );
}

function Input(props) {
  return (
    <TextInput
      placeholderTextColor={C.muted}
      selectionColor={C.lime}
      style={s.input}
      {...props}
    />
  );
}

function Section({ title, extra, onPress }) {
  return (
    <View style={s.section}>
      <Text style={s.h2}>{title}</Text>
      {extra && (
        <Pressable onPress={onPress} hitSlop={10}>
          <Text style={s.link}>{extra}</Text>
        </Pressable>
      )}
    </View>
  );
}

function Empty({ icon, title, text }) {
  return (
    <View style={s.empty}>
      <Icon name={icon} size={36} color={C.lime} />
      <Text style={s.h2}>{title}</Text>
      <Text style={[s.small, { textAlign: 'center' }]}>
        {text}
      </Text>
    </View>
  );
}

function Bar({ value }) {
  const percent = Math.max(
    0,
    Math.min(100, Number(value) || 0)
  );

  return (
    <View style={s.track}>
      <View style={[s.fill, { width: `${percent}%` }]} />
    </View>
  );
}

function Sheet({ visible, title, close, children }) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={close}
    >
      <View style={s.scrim}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={s.sheet}
        >
          <SafeAreaView edges={['bottom']}>
            <View style={s.sheetTop}>
              <Text style={s.h2}>{title}</Text>
              <Round
                icon="close"
                label="Close"
                onPress={close}
              />
            </View>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{
                padding: 22,
                gap: 14
              }}
            >
              {children}
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function Companion() {
  const [connection, setConnection] = useState(null);
  const [remoteVisible, setRemoteVisible] = useState(false);
  const [boot, setBoot] = useState(true);
  const [status, setStatus] = useState(null);
  const [catalog, setCatalog] = useState({
    apps: [],
    roots: [],
    modes: []
  });

  const [online, setOnline] = useState(false);
  const [updated, setUpdated] = useState('');
  const [caps, setCaps] = useState([]);

  const [tab, setTab] = useState('Home');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');

  const [settings, setSettings] = useState(false);
  const [url, setUrl] = useState('http://100.');
  const [token, setToken] = useState('');

  const [search, setSearch] = useState('');
  const [root, setRoot] = useState('');
  const [folder, setFolder] = useState('');
  const [entries, setEntries] = useState([]);
  const [next, setNext] = useState(null);

  const [modeSheet, setModeSheet] = useState(false);
  const [modeName, setModeName] = useState('');
  const [selected, setSelected] = useState([]);

  const [messages, setMessages] = useState([welcome]);
  const [draft, setDraft] = useState('');
  const [speak, setSpeak] = useState(false);
  const [keyboard, setKeyboard] = useState(false);

  const chatRef = useRef(null);
  const lock = useRef(false);
  const alive = useRef(true);
  const generation = useRef(0);

  useEffect(() => {
    alive.current = true;

    SecureStore.getItemAsync('connection')
      .then(value => {
        if (!alive.current) return;

        if (value) {
          const saved = JSON.parse(value);
          setConnection(saved);
          setUrl(saved.url);
          setToken(saved.token);
        } else {
          setSettings(true);
        }
      })
      .catch(() => {
        if (alive.current) setSettings(true);
      })
      .finally(() => {
        if (alive.current) setBoot(false);
      });

    const show = Keyboard.addListener(
      'keyboardDidShow',
      () => setKeyboard(true)
    );
    const hide = Keyboard.addListener(
      'keyboardDidHide',
      () => setKeyboard(false)
    );

    return () => {
      alive.current = false;
      show.remove();
      hide.remove();
      Speech.stop();
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!connection) return;

    let stopped = false;
    let running = false;
    let timer;
    let controller;

    async function poll() {
      if (
        stopped ||
        running ||
        AppState.currentState !== 'active'
      ) {
        return;
      }

      running = true;
      clearTimeout(timer);
      controller = new AbortController();

      const timeout = setTimeout(
        () => controller.abort(),
        8000
      );

      try {
        const [info, list] = await Promise.all([
          request(
            connection,
            '/status',
            undefined,
            controller.signal
          ),
          request(
            connection,
            '/catalog',
            undefined,
            controller.signal
          )
        ]);

        if (!stopped) {
          setStatus(info);
          setCatalog(list);
          setOnline(true);
          setUpdated(
            new Date().toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit'
            })
          );
        }
      } catch (e) {
        controller.abort();

        if (!stopped) {
          setOnline(false);

          if (e.status === 401) {
            setNotice(
              'Token rejected. Open connection settings to update it.'
            );
          }
        }
      } finally {
        clearTimeout(timeout);
        running = false;

        if (
          !stopped &&
          AppState.currentState === 'active'
        ) {
          timer = setTimeout(poll, 5000);
        }
      }
    }

    const listener = AppState.addEventListener(
      'change',
      state => {
        if (state === 'active') {
          poll();
        } else {
          clearTimeout(timer);
          controller?.abort();
          setOnline(false);
        }
      }
    );

    poll();

    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      listener.remove();
    };
  }, [connection]);

  useEffect(() => {
    let current = true;

    if (online) {
      request(connection, '/capabilities')
        .then(data => {
          if (current) setCaps(data.controls || []);
        })
        .catch(() => {
          if (current) setCaps([]);
        });
    }

    return () => {
      current = false;
    };
  }, [online, connection]);

  async function run(label, job) {
    if (lock.current) return;

    lock.current = true;
    setBusy(label);

    try {
      await job();
    } catch (e) {
      if (alive.current) {
        Alert.alert(
          'Could not complete request',
          e.name === 'AbortError'
            ? 'The request timed out. Check your laptop connection.'
            : e.message
        );
      }
    } finally {
      lock.current = false;
      if (alive.current) setBusy('');
    }
  }

  function switchTab(name) {
    setTab(name);
    setSearch('');
    Keyboard.dismiss();
  }

  async function refresh() {
    const epoch = generation.current;

    try {
      const [info, list] = await Promise.all([
        request(connection, '/status'),
        request(connection, '/catalog')
      ]);

      if (epoch !== generation.current) return;

      setStatus(info);
      setCatalog(list);
      setOnline(true);
      setUpdated(
        new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit'
        })
      );
    } catch (e) {
      if (epoch === generation.current) {
        setOnline(false);
      }
      throw e;
    }
  }

  async function connect() {
    const address = url.trim().replace(/\/$/, '');
    const match =
      /^http:\/\/100\.(\d+)\.(\d+)\.(\d+):4782$/.exec(address);

    if (
      !match ||
      +match[1] < 64 ||
      +match[1] > 127 ||
      +match[2] > 255 ||
      +match[3] > 255
    ) {
      throw new Error(
        'Enter your laptop’s Tailscale URL, such as http://100.90.80.70:4782.'
      );
    }

    if (token.trim().length < 32) {
      throw new Error(
        'Enter the complete token from your Windows .env file.'
      );
    }

    const saved = {
      url: address,
      token: token.trim()
    };

    const [info, list] = await Promise.all([
      request(saved, '/status'),
      request(saved, '/catalog')
    ]);

    await SecureStore.setItemAsync(
      'connection',
      JSON.stringify(saved)
    );

    generation.current++;
    setConnection(saved);
    setStatus(info);
    setCatalog(list);
    setOnline(true);
    setCaps([]);
    setRoot('');
    setFolder('');
    setEntries([]);
    setNext(null);
    setMessages([welcome]);
    setSelected([]);
    setDraft('');
    Speech.stop();
    setSettings(false);
    setNotice('Your laptop is connected.');
  }

  async function disconnect() {
    await SecureStore.deleteItemAsync('connection');

    generation.current++;
    setConnection(null);
    setStatus(null);
    setOnline(false);
    setCatalog({ apps: [], roots: [], modes: [] });
    setCaps([]);
    setToken('');
    setRoot('');
    setEntries([]);
    setMessages([welcome]);
    setDraft('');
    setSelected([]);
    Speech.stop();
    setSettings(false);
  }

  async function browse(r, p = '', offset = 0) {
    const result = await request(
      connection,
      `/files?${params({ root: r, path: p, offset })}`
    );

    setRoot(r);
    setFolder(p);
    setEntries(
      offset
        ? [...entries, ...result.entries]
        : result.entries
    );
    setNext(result.next);

    if (!offset) setSearch('');
  }

  async function action(kind, id) {
    const result = await request(
      connection,
      kind === 'app' ? '/launch' : '/mode',
      { id }
    );

    setNotice(result.message);
  }

  function file(entry) {
    const relativePath = folder
      ? `${folder}/${entry.name}`
      : entry.name;

    if (entry.directory) {
      return run(
        'Opening folder',
        () => browse(root, relativePath)
      );
    }

    Alert.alert(
      entry.name,
      'Open on your laptop or save a copy on your phone?',
      [
        {
          text: 'Cancel',
          style: 'cancel'
        },
        {
          text: 'Open on PC',
          onPress: () =>
            run('Opening file', async () => {
              const result = await request(
                connection,
                '/open',
                {
                  root,
                  path: relativePath
                }
              );

              setNotice(result.message);
            })
        },
        {
          text: 'Save to phone',
          onPress: () =>
            run('Choosing save folder', async () => {
              const saved = await saveDownload(
                connection,
                root,
                relativePath,
                entry.name,
                setBusy
              );

              if (saved) {
                Alert.alert(
                  'File saved',
                  `${entry.name} was saved in the folder you selected. Open your phone’s Files app to find it.`
                );
              }
            })
        }
      ]
    );
  }

  async function send() {
    if (!draft.trim()) return;

    const text = draft.trim();
    const conversation = [
      ...messages,
      { role: 'user', content: text }
    ];

    setMessages(conversation);
    setDraft('');

    try {
      const reply = await request(
        connection,
        '/chat',
        {
          messages: conversation.slice(-20).map(
            ({ role, content }) => ({ role, content })
          )
        }
      );

      setMessages([
        ...conversation,
        {
          role: 'assistant',
          content: reply.reply,
          action: reply.action
        }
      ]);

      if (speak) {
        Speech.stop();
        Speech.speak(reply.reply);
      }
    } catch (e) {
      setMessages(messages);
      setDraft(text);
      throw e;
    }
  }

  const disabled = !!busy || !online;

  const filteredApps = catalog.apps.filter(a =>
    a.label.toLowerCase().includes(search.toLowerCase())
  );

  const filteredFiles = entries.filter(e =>
    e.name.toLowerCase().includes(search.toLowerCase())
  );

  const battery = status?.battery;
  const hour = new Date().getHours();

  const greeting = hour < 12
    ? 'Good morning'
    : hour < 18
      ? 'Good afternoon'
      : 'Good evening';

  function modeCard(mode) {
    return (
      <Pressable
        key={mode.id}
        accessibilityRole="button"
        disabled={disabled}
        onPress={() =>
          run(
            'Starting mode',
            () => action('mode', mode.id)
          )
        }
        style={({ pressed }) => [
          s.row,
          pressed && { opacity: 0.6 }
        ]}
      >
        <View style={s.tile}>
          <Icon name="layers-outline" color={C.lime} />
        </View>

        <View style={s.flex}>
          <Text style={s.rowTitle}>{mode.name}</Text>
          <Text style={s.small}>
            {mode.apps.length} app
            {mode.apps.length === 1 ? '' : 's'} · Tap to run
          </Text>
        </View>

        <Icon
          name="play-circle-outline"
          color={disabled ? C.muted : C.lime}
          size={30}
        />
      </Pressable>
    );
  }

  if (boot) {
    return (
      <SafeAreaView style={[s.page, s.empty]}>
        <ActivityIndicator color={C.lime} />
        <Text style={s.small}>
          Opening your workspace…
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={s.page}
      edges={['top', 'bottom']}
    >
      <StatusBar
        barStyle="light-content"
        backgroundColor={C.bg}
      />

      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={s.header}>
          <View style={s.flex}>
            <Text style={s.brand}>POCKET / COMPANION</Text>

            <View style={s.inline}>
              <View
                style={[
                  s.dot,
                  {
                    backgroundColor: online
                      ? C.lime
                      : C.red
                  }
                ]}
              />
              <Text style={s.small} numberOfLines={1}>
                {online
                  ? status?.computer
                  : connection
                    ? 'Offline · reconnecting'
                    : 'No laptop connected'}
              </Text>
            </View>
          </View>

          <Round
            icon="options-outline"
            label="Connection settings"
            disabled={!!busy}
            onPress={() => setSettings(true)}
          />
        </View>

        {!!busy && (
          <View style={s.banner}>
            <ActivityIndicator
              size="small"
              color={C.lime}
            />
            <Text style={s.small}>{busy}…</Text>
          </View>
        )}

        {!!notice && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss notification"
            onPress={() => setNotice('')}
            style={s.banner}
          >
            <Icon
              name="information-circle-outline"
              color={C.lime}
              size={18}
            />
            <Text style={[s.small, s.flex]}>
              {notice}
            </Text>
            <Icon name="close" size={16} />
          </Pressable>
        )}

        {tab === 'Assistant' ? (
          <>
            <View style={s.chatHeading}>
              <View style={s.flex}>
                <Text style={s.title}>A little help.</Text>
                <Text style={s.small}>
                  Your laptop, in conversation.
                </Text>
              </View>

              <Round
                icon={
                  speak
                    ? 'volume-high-outline'
                    : 'volume-mute-outline'
                }
                label="Toggle spoken replies"
                active={speak}
                onPress={() => {
                  Speech.stop();
                  setSpeak(!speak);
                }}
              />

              <Round
                icon="trash-outline"
                label="Clear conversation"
                disabled={!!busy}
                onPress={() =>
                  Alert.alert(
                    'Clear this chat?',
                    'Your conversation is stored only for this session.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Clear',
                        onPress: () => {
                          Speech.stop();
                          setMessages([welcome]);
                        }
                      }
                    ]
                  )
                }
              />
            </View>

            <ScrollView
              ref={chatRef}
              contentContainerStyle={s.chatBody}
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={() =>
                chatRef.current?.scrollToEnd({
                  animated: true
                })
              }
            >
              <Text style={s.caption}>
                Chat sends your messages and laptop status to
                OpenAI. Your API key stays on Windows.
              </Text>

              {messages.map((message, index) => (
                <View
                  key={index}
                  style={[
                    s.bubble,
                    message.role === 'user' && s.userBubble
                  ]}
                >
                  <Text
                    style={[
                      s.brand,
                      {
                        color: message.role === 'user'
                          ? C.ink
                          : C.lime
                      }
                    ]}
                  >
                    {message.role === 'user'
                      ? 'YOU'
                      : 'COMPANION'}
                  </Text>

                  <Text
                    selectable
                    style={[
                      s.body,
                      message.role === 'user' && {
                        color: C.ink
                      }
                    ]}
                  >
                    {message.content}
                  </Text>

                  {message.action && (
                    <Button
                      title={`Run ${message.action.label}`}
                      icon="play-outline"
                      disabled={disabled}
                      onPress={() =>
                        Alert.alert(
                          'Run on your laptop?',
                          message.action.label,
                          [
                            { text: 'Cancel', style: 'cancel' },
                            {
                              text: 'Run',
                              onPress: () =>
                                run('Running action', () =>
                                  action(
                                    message.action.kind,
                                    message.action.id
                                  )
                                )
                            }
                          ]
                        )
                      }
                    />
                  )}
                </View>
              ))}

              {messages.length === 1 &&
                [
                  'How much battery is left?',
                  'Open Notepad',
                  'Start Work mode'
                ].map(prompt => (
                  <Pressable
                    key={prompt}
                    onPress={() => setDraft(prompt)}
                    style={s.prompt}
                  >
                    <Text style={s.small}>{prompt}</Text>
                    <Icon
                      name="arrow-up-outline"
                      size={16}
                      color={C.lime}
                    />
                  </Pressable>
                ))}
            </ScrollView>

            <View style={s.composer}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder={
                  online
                    ? 'Ask your companion…'
                    : 'Connect your laptop to chat'
                }
                placeholderTextColor={C.muted}
                style={s.chatInput}
                multiline
                maxLength={4000}
                editable={!busy}
              />

              <Round
                icon="arrow-up"
                label="Send message"
                active
                disabled={disabled || !draft.trim()}
                onPress={() => run('Thinking', send)}
              />
            </View>
          </>
        ) : (
          <ScrollView
            contentContainerStyle={s.content}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={busy === 'Refreshing'}
                tintColor={C.lime}
                colors={[C.ink]}
                onRefresh={() => {
                  if (connection) {
                    run('Refreshing', refresh);
                  }
                }}
              />
            }
          >
            {tab === 'Home' && (
              <>
                <Text style={s.small}>{greeting}.</Text>
                <Text style={s.title}>
                  Your desk. Anywhere.
                </Text>

                <View style={s.hero}>
                  <View style={s.between}>
                    <View style={[s.inline, s.flex]}>
                      <Icon
                        name="laptop-outline"
                        color={C.ink}
                        size={28}
                      />
                      <Text
                        numberOfLines={1}
                        style={[s.heroLabel, s.flex]}
                      >
                        {status?.computer || 'Your Windows laptop'}
                      </Text>
                    </View>

                    <Text style={s.heroLabel}>
                      {online ? 'CONNECTED' : 'OFFLINE'}
                    </Text>
                  </View>

                  <Text style={s.heroNumber}>
                    {battery?.present
                      ? `${battery.percent}%`
                      : '—'}
                  </Text>

                  <Text style={s.heroLabel}>
                    {battery?.present
                      ? battery.charging
                        ? 'Plugged in & charging'
                        : 'Battery remaining'
                      : 'Battery status appears after connecting'}
                  </Text>

                  <View style={s.heroFooter}>
                    <Text style={s.heroLabel}>
                      {updated
                        ? `${online ? 'Updated' : 'Last seen'} ${updated}`
                        : 'A private connection to your laptop'}
                    </Text>
                    <Icon
                      name="battery-half-outline"
                      color={C.ink}
                    />
                  </View>
                </View>

                {!online && (
                  <Button
                    title={
                      connection
                        ? 'Connection settings'
                        : 'Connect your laptop'
                    }
                    icon="link-outline"
                    onPress={() => setSettings(true)}
                  />
                )}

                <View style={s.grid}>
                  <View style={[s.card, s.flex]}>
                    <Icon
                      name="hardware-chip-outline"
                      color={C.lime}
                    />
                    <Text style={s.metric}>
                      {status ? gb(status.memory.used) : '—'}
                    </Text>
                    <Text style={s.small}>
                      Memory in use
                    </Text>
                    <Bar
                      value={
                        status?.memory.total
                          ? status.memory.used /
                          status.memory.total * 100
                          : 0
                      }
                    />
                  </View>

                  <View style={[s.card, s.flex]}>
                    <Icon
                      name="server-outline"
                      color={C.lime}
                    />
                    <Text style={s.metric}>
                      {status
                        ? gb(
                          status.disks.reduce(
                            (sum, disk) => sum + disk.available,
                            0
                          )
                        )
                        : '—'}
                    </Text>
                    <Text style={s.small}>
                      Available storage
                    </Text>
                    <Text style={s.caption}>
                      {status?.disks.length || 0} volumes reported
                    </Text>
                  </View>
                </View>

                <Section
                  title="At your fingertips"
                  extra="All apps"
                  onPress={() => switchTab('Apps')}
                />

                {catalog.apps.length ? (
                  <View style={s.grid}>
                    {catalog.apps.slice(0, 3).map(app => (
                      <Pressable
                        key={app.id}
                        disabled={disabled}
                        onPress={() =>
                          run(
                            'Opening app',
                            () => action('app', app.id)
                          )
                        }
                        style={[s.shortcut, s.flex]}
                      >
                        <View style={s.tile}>
                          <Icon
                            name="apps-outline"
                            color={C.lime}
                          />
                        </View>
                        <Text
                          numberOfLines={1}
                          style={s.small}
                        >
                          {app.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <Text style={s.small}>
                    Connect to see your approved applications.
                  </Text>
                )}

                <Button
                  title="Open remote controls"
                  icon="game-controller-outline"
                  disabled={!online}
                  onPress={() => setRemoteVisible(true)}
                />
                <Section title="Sound & playback" />

                <View style={s.card}>
                  <View style={s.media}>
                    {media.map(([icon, id, label]) => (
                      <Round
                        key={id}
                        icon={icon}
                        label={label}
                        active={id === 'playPause'}
                        disabled={
                          disabled || !caps.includes(id)
                        }
                        onPress={() =>
                          run('Sending control', async () => {
                            await request(
                              connection,
                              '/control',
                              { id }
                            );
                          })
                        }
                      />
                    ))}
                  </View>
                  <Text style={s.caption}>
                    {caps.length
                      ? 'Controls your active Windows media player.'
                      : 'Media controls require the upgraded Windows companion.'}
                  </Text>
                </View>

                <Section
                  title="Set the mood"
                  extra="All modes"
                  onPress={() => switchTab('Modes')}
                />

                {catalog.modes.length ? (
                  catalog.modes.slice(0, 2).map(modeCard)
                ) : (
                  <Text style={s.small}>
                    Create a mode to open your favorite apps together.
                  </Text>
                )}

                {!!status?.disks.length && (
                  <>
                    <Section title="Storage overview" />

                    {status.disks.map((disk, index) => (
                      <View key={index} style={s.card}>
                        <View style={s.between}>
                          <Text style={s.rowTitle}>
                            {disk.name}
                          </Text>
                          <Text style={s.small}>
                            {gb(disk.available)} free
                          </Text>
                        </View>
                        <Bar
                          value={
                            disk.size
                              ? (1 - disk.available / disk.size) * 100
                              : 0
                          }
                        />
                        <Text style={s.caption}>
                          {gb(disk.size)} total
                        </Text>
                      </View>
                    ))}
                  </>
                )}
              </>
            )}

            {tab === 'Files' && (
              <>
                <Text style={s.title}>
                  A little more space.
                </Text>
                <Text style={s.small}>
                  Your laptop’s folders, right here.
                </Text>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={s.chips}
                >
                  {catalog.roots.map(item => (
                    <Pressable
                      key={item}
                      disabled={disabled}
                      onPress={() =>
                        run(
                          'Opening folder',
                          () => browse(item)
                        )
                      }
                      style={[
                        s.chip,
                        root === item && {
                          backgroundColor: C.lime
                        }
                      ]}
                    >
                      <Icon
                        name="folder-outline"
                        size={18}
                        color={root === item ? C.ink : C.text}
                      />
                      <Text
                        style={{
                          color: root === item ? C.ink : C.text
                        }}
                      >
                        {item}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>

                {root ? (
                  <>
                    <View style={s.inline}>
                      <Round
                        icon="arrow-back"
                        label="Parent folder"
                        disabled={disabled || !folder}
                        onPress={() =>
                          run('Opening folder', () =>
                            browse(
                              root,
                              folder.split('/').slice(0, -1).join('/')
                            )
                          )
                        }
                      />
                      <Text
                        numberOfLines={2}
                        style={[s.small, s.flex]}
                      >
                        {root}
                        {folder
                          ? ` / ${folder.split('/').join(' / ')}`
                          : ''}
                      </Text>
                      <Round
                        icon="refresh-outline"
                        label="Refresh folder"
                        disabled={disabled}
                        onPress={() =>
                          run(
                            'Refreshing folder',
                            () => browse(root, folder)
                          )
                        }
                      />
                    </View>

                    <Input
                      placeholder="Search loaded items…"
                      value={search}
                      onChangeText={setSearch}
                    />

                    {filteredFiles.map(entry => (
                      <Pressable
                        key={entry.name}
                        disabled={disabled}
                        onPress={() => file(entry)}
                        style={s.row}
                      >
                        <View style={s.tile}>
                          <Icon
                            name={
                              entry.directory
                                ? 'folder-outline'
                                : 'document-text-outline'
                            }
                            color={
                              entry.directory
                                ? C.lime
                                : C.muted
                            }
                          />
                        </View>
                        <View style={s.flex}>
                          <Text
                            numberOfLines={2}
                            style={s.rowTitle}
                          >
                            {entry.name}
                          </Text>
                          <Text style={s.small}>
                            {entry.directory
                              ? 'Folder'
                              : 'Open on PC or save to phone'}
                          </Text>
                        </View>
                        <Icon
                          name="chevron-forward"
                          color={C.muted}
                          size={18}
                        />
                      </Pressable>
                    ))}

                    {!filteredFiles.length && (
                      <Empty
                        icon="search-outline"
                        title={
                          search
                            ? 'No matching items'
                            : 'Nothing here yet'
                        }
                        text={
                          search
                            ? 'Try a different name or load more items.'
                            : 'This folder is empty.'
                        }
                      />
                    )}

                    {next !== null && (
                      <Button
                        title="Load more files"
                        soft
                        disabled={disabled}
                        onPress={() =>
                          run(
                            'Loading files',
                            () => browse(root, folder, next)
                          )
                        }
                      />
                    )}
                  </>
                ) : (
                  <Empty
                    icon="folder-open-outline"
                    title="Pick a folder"
                    text={
                      catalog.roots.length
                        ? 'Choose an approved folder above to explore its contents.'
                        : 'Connect your laptop to see its shared folders.'
                    }
                  />
                )}
              </>
            )}

            {tab === 'Apps' && (
              <>
                <Text style={s.title}>
                  Ready when you are.
                </Text>
                <Text style={s.small}>
                  Launch an app on your laptop with one tap.
                </Text>

                <Input
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Find an application…"
                />

                {filteredApps.map(app => (
                  <Pressable
                    key={app.id}
                    disabled={disabled}
                    onPress={() =>
                      run(
                        'Opening app',
                        () => action('app', app.id)
                      )
                    }
                    style={s.row}
                  >
                    <View style={s.tile}>
                      <Icon
                        name="apps-outline"
                        color={C.lime}
                      />
                    </View>
                    <View style={s.flex}>
                      <Text style={s.rowTitle}>
                        {app.label}
                      </Text>
                      <Text style={s.small}>
                        Open on laptop
                      </Text>
                    </View>
                    <Icon
                      name="arrow-up-right-box-outline"
                      color={C.lime}
                    />
                  </Pressable>
                ))}

                {!filteredApps.length && (
                  <Empty
                    icon="apps-outline"
                    title="No apps to show"
                    text={
                      search
                        ? 'Try another app name.'
                        : 'Connect your laptop to see approved applications.'
                    }
                  />
                )}

                <Text style={s.caption}>
                  Manage approved applications in the Windows
                  companion configuration.
                </Text>
              </>
            )}

            {tab === 'Modes' && (
              <>
                <Text style={s.title}>
                  Make room for focus.
                </Text>
                <Text style={s.small}>
                  One tap. Your favorite apps, together.
                </Text>

                <Button
                  title="Create a mode"
                  icon="add"
                  disabled={
                    disabled || !catalog.apps.length
                  }
                  onPress={() => setModeSheet(true)}
                />

                {catalog.modes.map(modeCard)}

                {!catalog.modes.length && (
                  <Empty
                    icon="layers-outline"
                    title="Your routine starts here"
                    text="Create a Work, Study, or Movie mode using the apps on your laptop."
                  />
                )}
              </>
            )}
          </ScrollView>
        )}

        {!keyboard && (
          <View style={s.nav}>
            {tabs.map(([name, icon]) => (
              <Pressable
                key={name}
                accessibilityRole="tab"
                accessibilityState={{
                  selected: tab === name
                }}
                onPress={() => switchTab(name)}
                style={s.navItem}
              >
                <View
                  style={[
                    s.navIcon,
                    tab === name && {
                      backgroundColor: C.lime
                    }
                  ]}
                >
                  <Icon
                    name={icon}
                    size={21}
                    color={tab === name ? C.ink : C.muted}
                  />
                </View>
                <Text
                  style={[
                    s.navLabel,
                    tab === name && { color: C.lime }
                  ]}
                >
                  {name}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </KeyboardAvoidingView>

      <RemoteControls
        visible={remoteVisible}
        onClose={() => setRemoteVisible(false)}
        connection={connection}
        online={online}
      />

      <Sheet
        visible={settings}
        title="Your connection"
        close={() => {
          if (!busy) setSettings(false);
        }}
      >
        <Text style={s.small}>
          Keep Tailscale connected on your phone and laptop.
        </Text>

        <Text style={s.label}>LAPTOP ADDRESS</Text>
        <Input
          value={url}
          onChangeText={setUrl}
          placeholder="http://100.90.80.70:4782"
          autoCorrect={false}
          autoCapitalize="none"
          editable={!busy}
        />

        <Text style={s.label}>PRIVATE TOKEN</Text>
        <Input
          value={token}
          onChangeText={setToken}
          placeholder="Token from Windows .env"
          secureTextEntry
          autoCorrect={false}
          autoCapitalize="none"
          editable={!busy}
        />

        <Button
          title={
            busy === 'Connecting'
              ? 'Connecting…'
              : 'Connect laptop'
          }
          icon="link-outline"
          disabled={!!busy}
          onPress={() => run('Connecting', connect)}
        />

        <View style={s.between}>
          <Text style={s.body}>
            Spoken assistant replies
          </Text>
          <Switch
            value={speak}
            onValueChange={value => {
              Speech.stop();
              setSpeak(value);
            }}
            trackColor={{
              false: C.line,
              true: C.lime
            }}
            thumbColor={C.text}
          />
        </View>

        {connection && (
          <Button
            title="Disconnect & forget token"
            soft
            disabled={!!busy}
            onPress={() =>
              Alert.alert(
                'Disconnect this laptop?',
                'You can reconnect with its address and token.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Disconnect',
                    style: 'destructive',
                    onPress: () =>
                      run('Disconnecting', disconnect)
                  }
                ]
              )
            }
          />
        )}

        <Text style={s.caption}>
          Your token is stored securely on this phone.
          Your laptop must be awake for remote access.
        </Text>
      </Sheet>

      <Sheet
        visible={modeSheet}
        title="Create your mode"
        close={() => {
          if (!busy) setModeSheet(false);
        }}
      >
        <Input
          placeholder="Give it a name, e.g. Study"
          value={modeName}
          onChangeText={setModeName}
          maxLength={60}
        />

        <Text style={s.small}>
          Choose up to 10 applications to launch together.
        </Text>

        {catalog.apps.map(app => (
          <Pressable
            key={app.id}
            disabled={!!busy}
            onPress={() =>
              setSelected(
                selected.includes(app.id)
                  ? selected.filter(id => id !== app.id)
                  : selected.length < 10
                    ? [...selected, app.id]
                    : selected
              )
            }
            style={s.between}
          >
            <Text style={s.body}>{app.label}</Text>
            <Icon
              name={
                selected.includes(app.id)
                  ? 'checkbox'
                  : 'square-outline'
              }
              color={
                selected.includes(app.id)
                  ? C.lime
                  : C.muted
              }
            />
          </Pressable>
        ))}

        <Button
          title={`Save mode · ${selected.length} selected`}
          disabled={
            disabled ||
            !modeName.trim() ||
            !selected.length
          }
          onPress={() =>
            run('Saving mode', async () => {
              const saved = await request(
                connection,
                '/modes',
                {
                  name: modeName.trim(),
                  apps: selected
                }
              );

              setCatalog(current => ({
                ...current,
                modes: [
                  ...current.modes.filter(
                    mode => mode.id !== saved.id
                  ),
                  saved
                ]
              }));

              setModeName('');
              setSelected([]);
              setModeSheet(false);
              setNotice('Your new mode is ready.');
            })
          }
        />
      </Sheet>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Companion />
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: C.bg
  },
  flex: {
    flex: 1
  },
  header: {
    paddingHorizontal: 22,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  brand: {
    color: C.muted,
    fontSize: 10,
    letterSpacing: 2,
    fontWeight: '700',
    marginBottom: 8
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3
  },
  content: {
    padding: 22,
    paddingTop: 10,
    paddingBottom: 32,
    gap: 14
  },
  title: {
    color: C.text,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: '700',
    letterSpacing: -1.2
  },
  h2: {
    color: C.text,
    fontSize: 19,
    fontWeight: '600'
  },
  small: {
    color: C.muted,
    fontSize: 13,
    lineHeight: 20
  },
  body: {
    color: C.text,
    fontSize: 15,
    lineHeight: 23
  },
  caption: {
    color: C.muted,
    fontSize: 11,
    lineHeight: 17
  },
  label: {
    color: C.muted,
    fontSize: 11,
    letterSpacing: 1.5
  },
  section: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12
  },
  link: {
    color: C.lime,
    fontSize: 12
  },
  hero: {
    backgroundColor: C.lime,
    borderRadius: 26,
    padding: 22,
    marginTop: 6
  },
  heroLabel: {
    color: C.ink,
    fontSize: 11,
    fontWeight: '600'
  },
  heroNumber: {
    color: C.ink,
    fontSize: 70,
    lineHeight: 82,
    fontWeight: '700',
    letterSpacing: -4,
    marginTop: 18
  },
  heroFooter: {
    marginTop: 22,
    borderTopWidth: 1,
    borderTopColor: '#a6c86a',
    paddingTop: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  between: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10
  },
  grid: {
    flexDirection: 'row',
    gap: 12
  },
  card: {
    backgroundColor: C.card,
    borderRadius: 20,
    padding: 17,
    gap: 10
  },
  metric: {
    color: C.text,
    fontSize: 25,
    fontWeight: '600',
    marginTop: 4
  },
  track: {
    height: 5,
    backgroundColor: C.line,
    borderRadius: 3,
    overflow: 'hidden'
  },
  fill: {
    height: '100%',
    backgroundColor: C.lime,
    borderRadius: 3
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    padding: 15,
    borderRadius: 18,
    backgroundColor: C.card,
    minHeight: 78
  },
  rowTitle: {
    color: C.text,
    fontSize: 15,
    fontWeight: '600'
  },
  tile: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: C.raised,
    alignItems: 'center',
    justifyContent: 'center'
  },
  shortcut: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 16,
    borderRadius: 18,
    backgroundColor: C.card
  },
  round: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: C.raised,
    alignItems: 'center',
    justifyContent: 'center'
  },
  media: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 6
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    backgroundColor: C.lime,
    padding: 15,
    borderRadius: 15,
    minHeight: 48
  },
  buttonText: {
    color: C.ink,
    fontWeight: '700',
    fontSize: 14
  },
  input: {
    color: C.text,
    backgroundColor: C.raised,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.line,
    padding: 15,
    fontSize: 14,
    minHeight: 49
  },
  chips: {
    gap: 8,
    paddingVertical: 6
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 30,
    backgroundColor: C.raised
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 30,
    minHeight: 220
  },
  nav: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: C.line,
    backgroundColor: C.bg,
    paddingTop: 9,
    paddingBottom: 5
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4
  },
  navIcon: {
    width: 48,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center'
  },
  navLabel: {
    color: C.muted,
    fontSize: 10,
    fontWeight: '600'
  },
  banner: {
    marginHorizontal: 22,
    marginBottom: 8,
    padding: 11,
    borderRadius: 12,
    backgroundColor: C.raised,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9
  },
  scrim: {
    flex: 1,
    backgroundColor: '#00000099',
    justifyContent: 'flex-end'
  },
  sheet: {
    maxHeight: '90%',
    backgroundColor: C.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden'
  },
  sheetTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 22,
    paddingBottom: 0
  },
  chatHeading: {
    padding: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  chatBody: {
    paddingHorizontal: 22,
    paddingBottom: 22,
    gap: 16,
    flexGrow: 1
  },
  bubble: {
    backgroundColor: C.card,
    borderRadius: 20,
    borderTopLeftRadius: 5,
    padding: 17,
    maxWidth: '94%',
    alignSelf: 'flex-start',
    gap: 5
  },
  userBubble: {
    backgroundColor: C.lime,
    alignSelf: 'flex-end',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 5
  },
  prompt: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 13,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 14
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    marginHorizontal: 18,
    marginVertical: 12,
    padding: 8,
    paddingLeft: 14,
    backgroundColor: C.raised,
    borderRadius: 26
  },
  chatInput: {
    flex: 1,
    color: C.text,
    fontSize: 14,
    maxHeight: 110,
    minHeight: 42,
    paddingVertical: 10
  }
});