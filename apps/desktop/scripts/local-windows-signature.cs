// Query the Authenticode provider without installing the test certificate as a trusted root.
using System;
using System.Runtime.InteropServices;

public static class DshLocalAuthenticode
{
    [StructLayout(LayoutKind.Sequential)]
    private struct FileInfo
    {
        public uint Size;
        public IntPtr Path;
        public IntPtr Handle;
        public IntPtr KnownSubject;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct TrustData
    {
        public uint Size;
        public IntPtr PolicyCallback;
        public IntPtr SipClient;
        public uint UiChoice;
        public uint RevocationChecks;
        public uint UnionChoice;
        public IntPtr File;
        public uint StateAction;
        public IntPtr StateData;
        public IntPtr UrlReference;
        public uint ProviderFlags;
        public uint UiContext;
        public IntPtr SignatureSettings;
    }

    [DllImport("wintrust.dll", ExactSpelling = true)]
    private static extern int WinVerifyTrust(IntPtr window, ref Guid action, ref TrustData data);

    // A nonzero result remains a trust failure; the local caller admits only CERT_E_UNTRUSTEDROOT.
    public static int Verify(string path)
    {
        var file = new FileInfo { Size = (uint)Marshal.SizeOf(typeof(FileInfo)) };
        file.Path = Marshal.StringToCoTaskMemUni(path);
        IntPtr fileMemory = IntPtr.Zero;
        bool verificationRequested = false;
        var action = new Guid("00AAC56B-CD44-11D0-8CC2-00C04FC295EE");
        var data = new TrustData
        {
            Size = (uint)Marshal.SizeOf(typeof(TrustData)),
            UiChoice = 2, // WTD_UI_NONE
            UnionChoice = 1, // WTD_CHOICE_FILE
            StateAction = 1 // WTD_STATEACTION_VERIFY
        };
        try
        {
            fileMemory = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(FileInfo)));
            Marshal.StructureToPtr(file, fileMemory, false);
            data.File = fileMemory;
            verificationRequested = true;
            return WinVerifyTrust(new IntPtr(-1), ref action, ref data);
        }
        finally
        {
            if (verificationRequested)
            {
                data.StateAction = 2; // WTD_STATEACTION_CLOSE releases provider state.
                WinVerifyTrust(new IntPtr(-1), ref action, ref data);
            }
            if (fileMemory != IntPtr.Zero) Marshal.FreeHGlobal(fileMemory);
            Marshal.FreeCoTaskMem(file.Path);
        }
    }
}
