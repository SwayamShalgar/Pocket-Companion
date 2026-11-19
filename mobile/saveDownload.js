import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

export async function saveDownload(
  connection,
  root,
  relativePath,
  name,
  onProgress
) {
  if (Platform.OS !== 'android') {
    throw new Error('This save action is for Android.');
  }

  const saf = FileSystem.StorageAccessFramework;

  const permission =
    await saf.requestDirectoryPermissionsAsync();

  if (!permission.granted) {
    return false;
  }

  const temporary =
    `${FileSystem.cacheDirectory}download-` +
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  let destination;

  try {
    onProgress('Downloading file');

    const query =
      `root=${encodeURIComponent(root)}` +
      `&path=${encodeURIComponent(relativePath)}`;

    const result = await FileSystem.downloadAsync(
      `${connection.url}/download?${query}`,
      temporary,
      {
        headers: {
          Authorization: `Bearer ${connection.token}`
        }
      }
    );

    if (result.status !== 200) {
      throw new Error(
        `Download failed (${result.status}).`
      );
    }

    const info =
      await FileSystem.getInfoAsync(temporary);

    if (
      !info.exists ||
      info.isDirectory ||
      !Number.isFinite(info.size)
    ) {
      throw new Error(
        'Could not read the downloaded file.'
      );
    }

    const header = Object.entries(
      result.headers || {}
    ).find(
      ([key]) => key.toLowerCase() === 'content-type'
    );

    const mime = header
      ? header[1].split(';')[0].trim()
      : 'application/octet-stream';

    destination = await saf.createFileAsync(
      permission.directoryUri,
      name,
      mime
    );

    // SDK 58 supports ranged reads and append writes.
    const chunkSize = 1024 * 1024;

    for (
      let position = 0;
      position < info.size;
      position += chunkSize
    ) {
      const length = Math.min(
        chunkSize,
        info.size - position
      );

      const chunk =
        await FileSystem.readAsStringAsync(
          temporary,
          {
            encoding: FileSystem.EncodingType.Base64,
            position,
            length
          }
        );

      if (!chunk) {
        throw new Error(
          'The downloaded file could not be read completely.'
        );
      }

      await saf.writeAsStringAsync(
        destination,
        chunk,
        {
          encoding: FileSystem.EncodingType.Base64,
          append: position > 0
        }
      );

      const percent = Math.round(
        100 * (position + length) / info.size
      );

      onProgress(`Saving ${percent}%`);
    }

    const saved =
      await FileSystem.getInfoAsync(destination);

    if (
      !saved.exists ||
      saved.size !== info.size
    ) {
      throw new Error(
        'The selected folder did not save the complete file. Try a local folder in Internal storage.'
      );
    }

    return true;
  } catch (error) {
    if (destination) {
      await saf.deleteAsync(destination, {
        idempotent: true
      }).catch(() => {});
    }

    throw error;
  } finally {
    await FileSystem.deleteAsync(temporary, {
      idempotent: true
    }).catch(() => {});
  }
}