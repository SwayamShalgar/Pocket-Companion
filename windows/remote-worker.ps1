$ErrorActionPreference = 'Stop'

[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

Add-Type -AssemblyName System.Windows.Forms

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class PocketInput {
  [StructLayout(LayoutKind.Sequential)]
  public struct Point {
    public int X, Y;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct MouseInput {
    public int dx, dy;
    public uint data, flags, time;
    public UIntPtr extra;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct KeyInput {
    public ushort key, scan;
    public uint flags, time;
    public UIntPtr extra;
  }

  [StructLayout(LayoutKind.Explicit)]
  public struct Union {
    [FieldOffset(0)] public MouseInput mouse;
    [FieldOffset(0)] public KeyInput keyboard;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct Input {
    public uint type;
    public Union value;
  }

  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out Point p);

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int x, int y);

  [DllImport("user32.dll")]
  static extern void mouse_event(
    uint flags, uint x, uint y, uint data, UIntPtr extra
  );

  [DllImport("user32.dll")]
  static extern void keybd_event(
    byte key, byte scan, uint flags, UIntPtr extra
  );

  [DllImport("user32.dll", SetLastError = true)]
  static extern uint SendInput(
    uint count, Input[] input, int size
  );

  public static void Move(int x, int y) {
    Point p;

    if (
      !GetCursorPos(out p) ||
      !SetCursorPos(p.X + x, p.Y + y)
    ) {
      throw new Exception("Cannot move the desktop pointer.");
    }
  }

  public static void Click(bool right) {
    mouse_event(right ? 8u : 2u, 0, 0, 0, UIntPtr.Zero);
    mouse_event(right ? 16u : 4u, 0, 0, 0, UIntPtr.Zero);
  }

  public static void Scroll(int amount) {
    mouse_event(
      0x800, 0, 0, unchecked((uint)amount), UIntPtr.Zero
    );
  }

  public static void Key(byte[] keys) {
    try {
      foreach (byte k in keys) {
        keybd_event(k, 0, 0, UIntPtr.Zero);
      }
    } finally {
      for (int i = keys.Length - 1; i >= 0; i--) {
        keybd_event(keys[i], 0, 2, UIntPtr.Zero);
      }
    }
  }

  public static void Text(string text) {
    Input[] input = new Input[text.Length * 2];

    for (int i = 0; i < text.Length; i++) {
      input[i * 2].type = 1;
      input[i * 2].value.keyboard.scan = text[i];
      input[i * 2].value.keyboard.flags = 4;

      input[i * 2 + 1] = input[i * 2];
      input[i * 2 + 1].value.keyboard.flags = 6;
    }

    if (
      input.Length > 0 &&
      SendInput(
        (uint)input.Length,
        input,
        Marshal.SizeOf(typeof(Input))
      ) != (uint)input.Length
    ) {
      throw new Exception(
        "Windows blocked typing. Focus a normal desktop app first."
      );
    }
  }
}
'@

$keys = @{
    enter = @(13)
    tab = @(9)
    backspace = @(8)
    escape = @(27)
    up = @(38)
    down = @(40)
    left = @(37)
    right = @(39)
    copy = @(17, 67)
    paste = @(17, 86)
    selectAll = @(17, 65)
    switchApp = @(18, 9)
    desktop = @(91, 68)
}

while ($null -ne ($line = [Console]::ReadLine())) {
    $id = $null

    try {
        $command = $line | ConvertFrom-Json
        $id = $command.id
        $result = $null

        switch ($command.action) {
            'ping' {}

            'move' {
                [PocketInput]::Move(
                    [int]$command.dx,
                    [int]$command.dy
                )
            }

            'click' {
                [PocketInput]::Click(
                    $command.button -eq 'right'
                )
            }

            'scroll' {
                [PocketInput]::Scroll(
                    [int]$command.amount
                )
            }

            'key' {
                [PocketInput]::Key(
                    [byte[]]$keys[$command.key]
                )
            }

            'text' {
                [PocketInput]::Text(
                    [string]$command.text
                )
            }

            'clipboardSet' {
                if ([string]::IsNullOrEmpty($command.text)) {
                    [System.Windows.Forms.Clipboard]::Clear()
                } else {
                    [System.Windows.Forms.Clipboard]::SetText(
                        [string]$command.text
                    )
                }
            }

            'clipboardGet' {
                $result =
                    [System.Windows.Forms.Clipboard]::GetText()

                if ($result.Length -gt 10000) {
                    throw 'Clipboard text exceeds 10,000 characters.'
                }
            }

            default {
                throw 'Unknown remote action.'
            }
        }

        [Console]::WriteLine(
            (@{
                id = $id
                ok = $true
                text = $result
            } | ConvertTo-Json -Compress)
        )
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