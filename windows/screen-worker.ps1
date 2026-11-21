$ErrorActionPreference = 'Stop'

[Console]::InputEncoding =
    New-Object System.Text.UTF8Encoding($false)

[Console]::OutputEncoding =
    New-Object System.Text.UTF8Encoding($false)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$references = @(
    [System.Drawing.Bitmap].Assembly.Location,
    [System.Windows.Forms.Screen].Assembly.Location,
    [System.ComponentModel.Component].Assembly.Location
)

Add-Type -ReferencedAssemblies $references -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public static class PocketScreen {
  [DllImport("user32.dll")]
  static extern bool SetProcessDPIAware();

  [DllImport("user32.dll")]
  static extern bool SetProcessDpiAwarenessContext(
    IntPtr context
  );

  [DllImport("user32.dll")]
  static extern IntPtr GetForegroundWindow();

  public static void Init() {
    try {
      if (
        !SetProcessDpiAwarenessContext(new IntPtr(-4))
      ) {
        SetProcessDPIAware();
      }
    } catch (EntryPointNotFoundException) {
      SetProcessDPIAware();
    }
  }

  public static Rectangle Bounds(int display) {
    Screen[] screens = Screen.AllScreens;

    if (display == -1) {
      return SystemInformation.VirtualScreen;
    }

    if (display < 0 || display >= screens.Length) {
      throw new Exception(
        "Monitor changed. Select another monitor."
      );
    }

    return screens[display].Bounds;
  }

  public static byte[] Capture(int display) {
    if (GetForegroundWindow() == IntPtr.Zero) {
      throw new Exception(
        "Desktop capture is unavailable. Unlock the laptop first."
      );
    }

    Rectangle bounds = Bounds(display);

    if (
      bounds.Width <= 0 ||
      bounds.Height <= 0 ||
      (long)bounds.Width * bounds.Height > 40000000
    ) {
      throw new Exception(
        "Desktop is too large. Select one monitor."
      );
    }

    double scale = Math.Min(
      1.0,
      1280.0 / Math.Max(bounds.Width, bounds.Height)
    );

    int width = Math.Max(
      1,
      (int)(bounds.Width * scale)
    );

    int height = Math.Max(
      1,
      (int)(bounds.Height * scale)
    );

    using (
      Bitmap source = new Bitmap(
        bounds.Width,
        bounds.Height,
        PixelFormat.Format24bppRgb
      )
    ) {
      using (
        Graphics capture = Graphics.FromImage(source)
      ) {
        capture.CopyFromScreen(
          bounds.Left,
          bounds.Top,
          0,
          0,
          bounds.Size,
          CopyPixelOperation.SourceCopy
        );
      }

      using (
        Bitmap resized = new Bitmap(
          width,
          height,
          PixelFormat.Format24bppRgb
        )
      ) {
        using (
          Graphics drawing = Graphics.FromImage(resized)
        ) {
          drawing.InterpolationMode =
            InterpolationMode.HighQualityBilinear;

          drawing.DrawImage(
            source,
            0,
            0,
            width,
            height
          );
        }

        ImageCodecInfo jpeg = null;

        foreach (
          ImageCodecInfo codec in
          ImageCodecInfo.GetImageEncoders()
        ) {
          if (codec.MimeType == "image/jpeg") {
            jpeg = codec;
          }
        }

        using (
          MemoryStream stream = new MemoryStream()
        )
        using (
          EncoderParameters options =
            new EncoderParameters(1)
        ) {
          options.Param[0] = new EncoderParameter(
            System.Drawing.Imaging.Encoder.Quality,
            65L
          );

          resized.Save(stream, jpeg, options);
          return stream.ToArray();
        }
      }
    }
  }
}
'@

[PocketScreen]::Init()

while ($null -ne ($line = [Console]::ReadLine())) {
    $id = $null

    try {
        $command = $line | ConvertFrom-Json
        $id = $command.id

        if ($command.action -eq 'displays') {
            $screens =
                [System.Windows.Forms.Screen]::AllScreens

            $items = @(
                @{
                    id = -1
                    label = 'Entire desktop'
                }
            )

            for (
                $i = 0;
                $i -lt $screens.Length;
                $i++
            ) {
                $label = 'Monitor ' + ($i + 1)

                if ($screens[$i].Primary) {
                    $label += ' (primary)'
                }

                $items += @{
                    id = $i
                    label = $label
                }
            }

            $result = @{
                displays = $items
            }
        } elseif ($command.action -eq 'frame') {
            $display = [int]$command.display
            $bounds = [PocketScreen]::Bounds($display)
            $bytes = [PocketScreen]::Capture($display)

            $scale = [Math]::Min(
                1.0,
                1280.0 / [Math]::Max(
                    $bounds.Width,
                    $bounds.Height
                )
            )

            $result = @{
                jpeg = [Convert]::ToBase64String($bytes)

                width = [Math]::Max(
                    1,
                    [int][Math]::Floor(
                        $bounds.Width * $scale
                    )
                )

                height = [Math]::Max(
                    1,
                    [int][Math]::Floor(
                        $bounds.Height * $scale
                    )
                )
            }

            $bytes = $null
        } else {
            throw 'Unknown screen request.'
        }

        [Console]::WriteLine(
            (@{
                id = $id
                ok = $true
                result = $result
            } | ConvertTo-Json -Depth 6 -Compress)
        )

        $result = $null
    } catch {
        [Console]::WriteLine(
            (@{
                id = $id
                ok = $false
                error = $_.Exception.Message
            } | ConvertTo-Json -Compress)
        )
    }
}