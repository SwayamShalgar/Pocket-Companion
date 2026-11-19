import React, {
  useEffect,
  useRef,
  useState
} from 'react';

import {
  AppState,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';

import {
  SafeAreaView
} from 'react-native-safe-area-context';

import * as Clipboard from 'expo-clipboard';

export default function RemoteControls({
  visible,
  onClose,
  connection,
  online
}) {
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState(
    'Connecting remote controls…'
  );
  const [text, setText] = useState('');
  const [attempt, setAttempt] = useState(0);

  const state = useRef({
    queue: [],
    running: false,
    active: false,
    ready: false,
    epoch: 0,
    dx: 0,
    dy: 0
  });

  state.current.connection = connection;

  function stop() {
    const current = state.current;

    current.epoch++;
    current.active = false;
    current.ready = false;
    current.queue = [];
    current.dx = 0;
    current.dy = 0;
    current.controller?.abort();
    current.running = false;
  }

  async function pump() {
    const current = state.current;

    if (
      !current.active ||
      current.running ||
      !current.queue.length
    ) {
      return;
    }

    current.running = true;

    const epoch = current.epoch;
    const item = current.queue.shift();
    const controller = new AbortController();

    current.controller = controller;

    const timeout = setTimeout(
      () => controller.abort(),
      12000
    );

    try {
      const response = await fetch(
        current.connection.url + '/remote',
        {
          method: 'POST',
          headers: {
            Authorization:
              `Bearer ${current.connection.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(item.command),
          signal: controller.signal
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error || 'Remote action failed.'
        );
      }

      if (
        epoch === current.epoch &&
        current.active
      ) {
        await item.done?.(result);
      }
    } catch (error) {
      if (
        epoch === current.epoch &&
        current.active
      ) {
        stop();
        setReady(false);

        setMessage(
          error.name === 'AbortError'
            ? 'Connection timed out. Commands were not retried. Tap Reconnect.'
            : error.message
        );
      }
    } finally {
      clearTimeout(timeout);

      if (epoch === current.epoch) {
        current.running = false;
        pump();
      }
    }
  }

  function enqueue(command, done) {
    const current = state.current;

    if (!current.active) return;

    if (current.queue.length >= 8) {
      setMessage(
        'Please wait for the previous actions.'
      );
      return;
    }

    current.queue.push({ command, done });
    pump();
  }

  function flush() {
    const current = state.current;

    if (
      !current.ready ||
      (!current.dx && !current.dy)
    ) {
      return;
    }

    const dx = current.dx;
    const dy = current.dy;

    current.dx = 0;
    current.dy = 0;

    enqueue({
      action: 'move',
      dx,
      dy
    });
  }

  function perform(command, done) {
    if (!state.current.ready) return;

    flush();
    enqueue(command, done);
  }

  useEffect(() => {
    stop();
    setReady(false);

    if (!visible || !online || !connection) {
      setMessage(
        'Connect your laptop to use remote controls.'
      );
      return;
    }

    function start() {
      stop();
      state.current.active = true;
      setReady(false);
      setMessage('Preparing Windows controls…');

      enqueue({ action: 'ping' }, () => {
        state.current.ready = true;
        setReady(true);
        setMessage(
          'Ready. Focus a normal desktop app on your laptop.'
        );
      });
    }

    if (AppState.currentState === 'active') {
      start();
    }

    const listener = AppState.addEventListener(
      'change',
      value => {
        if (value === 'active') {
          start();
        } else {
          stop();
          setReady(false);
        }
      }
    );

    const timer = setInterval(() => {
      const current = state.current;

      if (
        !current.running &&
        !current.queue.length
      ) {
        flush();
      }
    }, 80);

    return () => {
      stop();
      clearInterval(timer);
      listener.remove();
    };
  }, [visible, online, connection, attempt]);

  const handlers = useRef({});
  handlers.current = { perform };

  const gesture = useRef({
    x: 0,
    y: 0,
    distance: 0,
    started: 0
  });

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () =>
        state.current.ready,

      onMoveShouldSetPanResponder: () =>
        state.current.ready,

      onPanResponderGrant: () => {
        gesture.current = {
          x: 0,
          y: 0,
          distance: 0,
          started: Date.now()
        };
      },

      onPanResponderMove: (_, movement) => {
        if (!state.current.ready) return;

        const previous = gesture.current;
        const current = state.current;

        current.dx = Math.max(
          -500,
          Math.min(
            500,
            current.dx +
              Math.round(
                (movement.dx - previous.x) * 1.8
              )
          )
        );

        current.dy = Math.max(
          -500,
          Math.min(
            500,
            current.dy +
              Math.round(
                (movement.dy - previous.y) * 1.8
              )
          )
        );

        previous.x = movement.dx;
        previous.y = movement.dy;

        previous.distance = Math.max(
          previous.distance,
          Math.abs(movement.dx) +
            Math.abs(movement.dy)
        );
      },

      onPanResponderRelease: () => {
        const current = gesture.current;

        if (
          current.distance < 6 &&
          Date.now() - current.started < 350
        ) {
          handlers.current.perform({
            action: 'click',
            button: 'left'
          });
        }
      },

      onPanResponderTerminate: () => {
        state.current.dx = 0;
        state.current.dy = 0;
      }
    })
  ).current;

  async function phoneToPC() {
    try {
      const value = await Clipboard.getStringAsync();

      if (!state.current.ready) return;

      if (value.length > 10000) {
        setMessage(
          'Clipboard text must be under 10,000 characters.'
        );
        return;
      }

      perform(
        {
          action: 'clipboardSet',
          text: value
        },
        () => setMessage(
          'Phone text copied to the Windows clipboard.'
        )
      );
    } catch {
      setMessage(
        'Could not read the phone clipboard.'
      );
    }
  }

  function Button({
    label,
    onPress,
    available = ready
  }) {
    return (
      <Pressable
        accessibilityRole="button"
        disabled={!available}
        onPress={onPress}
        style={[
          s.button,
          !available && { opacity: 0.4 }
        ]}
      >
        <Text style={s.buttonText}>
          {label}
        </Text>
      </Pressable>
    );
  }

  const shortcuts = [
    ['Enter', 'enter'],
    ['Tab', 'tab'],
    ['Backspace', 'backspace'],
    ['Esc', 'escape'],
    ['↑', 'up'],
    ['↓', 'down'],
    ['←', 'left'],
    ['→', 'right'],
    ['Select all', 'selectAll'],
    ['Copy', 'copy'],
    ['Paste', 'paste'],
    ['Switch app', 'switchApp'],
    ['Show desktop', 'desktop']
  ];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
    >
      <SafeAreaView style={s.page}>
        <View style={s.header}>
          <Text style={s.title}>
            Remote control
          </Text>

          <Button
            label="Close"
            available
            onPress={onClose}
          />
        </View>

        <ScrollView
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={s.muted}>
            {message}
          </Text>

          {!ready && online && (
            <Button
              label="Reconnect controls"
              available
              onPress={() =>
                setAttempt(value => value + 1)
              }
            />
          )}

          <View
            {...responder.panHandlers}
            style={[
              s.pad,
              !ready && { opacity: 0.45 }
            ]}
          >
            <Text style={s.padTitle}>
              TOUCHPAD
            </Text>
            <Text style={s.muted}>
              Slide to move · Tap to click
            </Text>
          </View>

          <View style={s.row}>
            <Button
              label="Left click"
              onPress={() =>
                perform({
                  action: 'click',
                  button: 'left'
                })
              }
            />
            <Button
              label="Right click"
              onPress={() =>
                perform({
                  action: 'click',
                  button: 'right'
                })
              }
            />
          </View>

          <View style={s.row}>
            <Button
              label="Scroll ↑"
              onPress={() =>
                perform({
                  action: 'scroll',
                  amount: 360
                })
              }
            />
            <Button
              label="Scroll ↓"
              onPress={() =>
                perform({
                  action: 'scroll',
                  amount: -360
                })
              }
            />
          </View>

          <Text style={s.heading}>
            Keyboard
          </Text>
          <Text style={s.muted}>
            Text goes to the focused application on your laptop.
          </Text>

          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            maxLength={1000}
            placeholder="Text to type on your PC…"
            placeholderTextColor="#a4ae9e"
            style={s.input}
          />

          <Button
            label="Type on PC"
            available={ready && !!text}
            onPress={() =>
              perform(
                { action: 'text', text },
                () => {
                  setText('');
                  setMessage('Text sent to Windows.');
                }
              )
            }
          />

          <View style={s.row}>
            {shortcuts.map(([label, key]) => (
              <Button
                key={key}
                label={label}
                onPress={() =>
                  perform({ action: 'key', key })
                }
              />
            ))}
          </View>

          <Text style={s.heading}>
            Clipboard
          </Text>
          <Text style={s.muted}>
            Text only. Clipboard access happens when you tap a button.
          </Text>

          <Button
            label="Phone clipboard → PC"
            onPress={phoneToPC}
          />

          <Button
            label="PC clipboard → Phone"
            onPress={() =>
              perform(
                { action: 'clipboardGet' },
                async result => {
                  await Clipboard.setStringAsync(
                    result.text || ''
                  );

                  setMessage(
                    'Windows text copied to your phone clipboard.'
                  );
                }
              )
            }
          />

          <Text style={s.muted}>
            This is a controller, not a screen viewer.
            Windows must be signed in and unlocked.
            Administrator prompts and protected apps may block input.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#101310'
  },
  header: {
    padding: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  title: {
    color: '#f1f4eb',
    fontSize: 23,
    fontWeight: '700'
  },
  content: {
    padding: 20,
    paddingBottom: 40,
    gap: 14
  },
  muted: {
    color: '#a4ae9e',
    fontSize: 13,
    lineHeight: 20
  },
  heading: {
    color: '#f1f4eb',
    fontSize: 19,
    fontWeight: '700',
    marginTop: 10
  },
  pad: {
    height: 220,
    backgroundColor: '#1b201b',
    borderWidth: 1,
    borderColor: '#46553a',
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12
  },
  padTitle: {
    color: '#d0f58a',
    fontSize: 16,
    letterSpacing: 3,
    fontWeight: '700'
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9
  },
  button: {
    backgroundColor: '#d0f58a',
    paddingHorizontal: 15,
    paddingVertical: 13,
    borderRadius: 13
  },
  buttonText: {
    color: '#243416',
    fontWeight: '700',
    fontSize: 13
  },
  input: {
    minHeight: 90,
    maxHeight: 150,
    color: '#f1f4eb',
    backgroundColor: '#252c24',
    borderRadius: 14,
    padding: 15,
    textAlignVertical: 'top'
  }
});