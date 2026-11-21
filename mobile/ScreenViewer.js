import React, {
  useEffect,
  useState
} from 'react';

import {
  ActivityIndicator,
  AppState,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  View
} from 'react-native';

import * as ScreenOrientation from 'expo-screen-orientation';

import {
  SafeAreaView
} from 'react-native-safe-area-context';

import {
  Button,
  palette as C,
  useReducedMotion
} from './ui/Experience';

export default function ScreenViewer({
  visible,
  onClose,
  connection,
  online
}) {
  const reduced = useReducedMotion();

  const [active, setActive] = useState(
    AppState.currentState === 'active'
  );

  const [paused, setPaused] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [displays, setDisplays] = useState([]);
  const [display, setDisplay] = useState(-1);
  const [frame, setFrame] = useState(null);

  const [message, setMessage] = useState(
    'Preparing screen viewer…'
  );

  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);

  const [viewport, setViewport] = useState({
    width: 1,
    height: 1
  });

  useEffect(() => {
    if (!visible) return;

    let previous = null;
    let cancelled = false;

    (async () => {
      previous =
        await ScreenOrientation.getOrientationLockAsync();

      if (cancelled) return;

      await ScreenOrientation.unlockAsync();

      if (cancelled) {
        await ScreenOrientation.lockAsync(previous);
      }
    })().catch(() => {});

    return () => {
      cancelled = true;

      if (previous !== null) {
        ScreenOrientation.lockAsync(previous)
          .catch(() => {});
      }
    };
  }, [visible]);

  useEffect(() => {
    const listener = AppState.addEventListener(
      'change',
      state => setActive(state === 'active')
    );

    return () => listener.remove();
  }, []);

  useEffect(() => {
    if (visible) {
      setPaused(false);
      setZoom(1);
    }
  }, [visible]);

  useEffect(() => {
    let cancelled = false;
    let timer;
    let controller;

    setFrame(null);
    setFailed(false);
    setLoading(false);

    if (
      !visible ||
      paused ||
      !active ||
      !connection ||
      !online
    ) {
      setMessage(
        !online
          ? 'Laptop offline. Connect and unlock it to view the desktop.'
          : 'Screen viewing stopped.'
      );

      return;
    }

    async function get(route) {
      controller = new AbortController();

      const timeout = setTimeout(
        () => controller.abort(),
        12000
      );

      try {
        const response = await fetch(
          connection.url + route,
          {
            headers: {
              Authorization:
                `Bearer ${connection.token}`
            },
            signal: controller.signal
          }
        );

        const raw = await response.text();
        let result;

        try {
          result = JSON.parse(raw);
        } catch {
          throw new Error(
            `Screen endpoint returned HTTP ${response.status}. Register screen.cjs and restart the companion.`
          );
        }

        if (!response.ok) {
          throw Object.assign(
            new Error(
              result.error || 'Screen request failed.'
            ),
            { status: response.status }
          );
        }

        return result;
      } finally {
        clearTimeout(timeout);
      }
    }

    function fail(error) {
      if (cancelled) return;

      setFrame(null);
      setLoading(false);
      setFailed(true);

      setMessage(
        error.name === 'AbortError'
          ? 'Screen request timed out. Unlock the laptop and retry.'
          : error.message
      );
    }

    async function next() {
      if (cancelled) return;

      try {
        const result = await get(
          `/screen/frame?display=${display}`
        );

        if (cancelled) return;

        if (
          typeof result.jpeg !== 'string' ||
          !(result.width > 0) ||
          !(result.height > 0)
        ) {
          throw new Error('Invalid screen frame.');
        }

        setFrame(result);
        setLoading(false);
        setFailed(false);

        setMessage(
          `Live · received ${new Date().toLocaleTimeString()} · no audio`
        );

        timer = setTimeout(next, 650);
      } catch (error) {
        if (
          !cancelled &&
          error.status === 429
        ) {
          timer = setTimeout(next, 1000);
          return;
        }

        fail(error);
      }
    }

    setLoading(true);
    setMessage('Preparing Windows screen capture…');

    get('/screen/displays')
      .then(result => {
        if (cancelled) return;

        if (!Array.isArray(result.displays)) {
          throw new Error('Invalid monitor list.');
        }

        setDisplays(result.displays);

        if (
          !result.displays.some(
            item => item.id === display
          )
        ) {
          setDisplay(-1);
          return;
        }

        next();
      })
      .catch(fail);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller?.abort();
    };
  }, [
    visible,
    paused,
    active,
    online,
    connection,
    display,
    attempt
  ]);

  const fit = frame
    ? Math.min(
      viewport.width / frame.width,
      viewport.height / frame.height
    )
    : 1;

  const imageWidth = frame
    ? frame.width * fit * zoom
    : 1;

  const imageHeight = frame
    ? frame.height * fit * zoom
    : 1;

  return (
    <Modal
      visible={visible}
      animationType={reduced ? 'none' : 'slide'}
      onRequestClose={onClose}
    >
      <SafeAreaView style={s.page}>
        <View style={s.header}>
          <Text style={s.title}>
            Laptop screen
          </Text>

          <Button
            title="Close"
            soft
            onPress={onClose}
          />
        </View>

        <Text style={s.status}>
          {message}
        </Text>

        <View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.options}
          >
            {displays.map(item => (
              <Button
                key={item.id}
                title={item.label}
                soft={display !== item.id}
                disabled={!online}
                onPress={() => {
                  setDisplay(item.id);
                  setZoom(1);
                }}
              />
            ))}
          </ScrollView>
        </View>

        <View
          style={s.canvas}
          onLayout={event =>
            setViewport(event.nativeEvent.layout)
          }
        >
          {frame ? (
            <ScrollView
              horizontal
              nestedScrollEnabled
              contentContainerStyle={{
                minWidth: viewport.width,
                minHeight: viewport.height
              }}
            >
              <ScrollView
                nestedScrollEnabled
                style={{
                  width: Math.max(
                    viewport.width,
                    imageWidth
                  ),
                  height: viewport.height
                }}
                contentContainerStyle={{
                  minHeight: viewport.height,
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <Image
                  accessible
                  accessibilityLabel="Live screenshot of the selected Windows desktop"
                  source={{
                    uri:
                      `data:image/jpeg;base64,${frame.jpeg}`
                  }}
                  style={{
                    width: imageWidth,
                    height: imageHeight
                  }}
                  resizeMode="contain"
                />
              </ScrollView>
            </ScrollView>
          ) : (
            <View style={s.empty}>
              {loading && (
                <ActivityIndicator color={C.lime} />
              )}

              <Text style={s.hint}>
                {loading
                  ? 'Waiting for the first frame…'
                  : paused
                    ? 'Screen viewing is stopped.'
                    : failed
                      ? 'Check the message above, then retry.'
                      : 'No screen available.'}
              </Text>
            </View>
          )}
        </View>

        <View style={s.toolbar}>
          <Button
            title={
              paused ? 'Start viewing' : 'Stop viewing'
            }
            soft={!paused}
            disabled={!online}
            onPress={() => setPaused(!paused)}
          />

          {failed && (
            <Button
              title="Retry"
              disabled={!online}
              onPress={() => {
                setPaused(false);
                setAttempt(value => value + 1);
              }}
            />
          )}

          <Button
            title={zoom === 1 ? 'Zoom 2×' : 'Fit screen'}
            soft
            disabled={!frame}
            onPress={() =>
              setZoom(zoom === 1 ? 2 : 1)
            }
          />
        </View>

        <Text style={s.footer}>
          Rotate for landscape · Read-only view ·
          approximately 1–2 frames/sec. Drag to pan when
          zoomed. Capture pauses in the background.
          Protected content may appear blank.
        </Text>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: C.bg
  },
  header: {
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12
  },
  title: {
    color: C.text,
    fontSize: 23,
    fontWeight: '700'
  },
  status: {
    color: C.muted,
    fontSize: 12,
    lineHeight: 18,
    paddingHorizontal: 18,
    paddingBottom: 8
  },
  options: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    gap: 8
  },
  canvas: {
    flex: 1,
    backgroundColor: '#000',
    marginVertical: 10
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16
  },
  hint: {
    color: C.muted,
    textAlign: 'center'
  },
  toolbar: {
    paddingHorizontal: 18,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  footer: {
    color: C.muted,
    fontSize: 11,
    lineHeight: 17,
    padding: 18
  }
});