<#
.SYNOPSIS
    raw-spooler.ps1 - Envía bytes binarios ESC/POS directamente al Spooler de Windows en modo "RAW".
.DESCRIPTION
    Utiliza Add-Type con P/Invoke a winspool.Drv (OpenPrinter, StartDocPrinter, StartPagePrinter,
    WritePrinter, EndPagePrinter, EndDocPrinter, ClosePrinter).
    No utiliza Out-Printer ni cuadros de diálogo.
.PARAMETER PrinterName
    Nombre exacto de la impresora en Windows (tal como figura en Get-Printer).
.PARAMETER FilePath
    Ruta a un archivo binario con los bytes ESC/POS.
.PARAMETER Base64Data
    Cadena en Base64 con los bytes ESC/POS.
.PARAMETER DocName
    Nombre identificador del trabajo de impresión para el spooler.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$PrinterName,

    [Parameter(Mandatory = $false, Position = 1)]
    [string]$FilePath,

    [Parameter(Mandatory = $false)]
    [string]$Base64Data,

    [Parameter(Mandatory = $false)]
    [string]$DocName = "TocinetaSonrie_G0_Probe"
)

# Definición del helper C# winspool.Drv
$cSharpCode = @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.ComponentModel;

namespace TocinetaSonrie.Hardware
{
    public static class RawPrinterHelper
    {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public class DOCINFOW
        {
            [MarshalAs(UnmanagedType.LPWStr)]
            public string pDocName;
            [MarshalAs(UnmanagedType.LPWStr)]
            public string pOutputFile;
            [MarshalAs(UnmanagedType.LPWStr)]
            public string pDataType; // "RAW"
        }

        [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);

        [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool ClosePrinter(IntPtr hPrinter);

        [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern int StartDocPrinter(IntPtr hPrinter, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOW di);

        [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool EndDocPrinter(IntPtr hPrinter);

        [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool StartPagePrinter(IntPtr hPrinter);

        [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool EndPagePrinter(IntPtr hPrinter);

        [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

        public static int SendBytes(string printerName, byte[] bytes, string docName)
        {
            if (bytes == null || bytes.Length == 0)
            {
                throw new ArgumentException("El arreglo de bytes a imprimir no puede estar vacío.");
            }

            IntPtr hPrinter = IntPtr.Zero;
            DOCINFOW di = new DOCINFOW();
            di.pDocName = string.IsNullOrEmpty(docName) ? "G0_RAW_JOB" : docName;
            di.pOutputFile = null;
            di.pDataType = "RAW";

            if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
            {
                int err = Marshal.GetLastWin32Error();
                throw new Win32Exception(err, string.Format("OpenPrinter falló para '{0}' (Win32 Error: {1})", printerName, err));
            }

            int bytesWritten = 0;
            int jobId = 0;

            try
            {
                jobId = StartDocPrinter(hPrinter, 1, di);
                if (jobId <= 0)
                {
                    int err = Marshal.GetLastWin32Error();
                    throw new Win32Exception(err, string.Format("StartDocPrinter falló para '{0}' (Win32 Error: {1})", printerName, err));
                }

                try
                {
                    if (!StartPagePrinter(hPrinter))
                    {
                        int err = Marshal.GetLastWin32Error();
                        throw new Win32Exception(err, string.Format("StartPagePrinter falló para '{0}' (Win32 Error: {1})", printerName, err));
                    }

                    try
                    {
                        IntPtr pUnmanagedBytes = Marshal.AllocCoTaskMem(bytes.Length);
                        try
                        {
                            Marshal.Copy(bytes, 0, pUnmanagedBytes, bytes.Length);
                            bool writeOk = WritePrinter(hPrinter, pUnmanagedBytes, bytes.Length, out bytesWritten);
                            if (!writeOk)
                            {
                                int err = Marshal.GetLastWin32Error();
                                throw new Win32Exception(err, string.Format("WritePrinter falló para '{0}' (Win32 Error: {1})", printerName, err));
                            }
                        }
                        finally
                        {
                            Marshal.FreeCoTaskMem(pUnmanagedBytes);
                        }
                    }
                    finally
                    {
                        EndPagePrinter(hPrinter);
                    }
                }
                finally
                {
                    EndDocPrinter(hPrinter);
                }
            }
            finally
            {
                ClosePrinter(hPrinter);
            }

            return bytesWritten;
        }
    }
}
'@

# Compilar C# si aún no está cargado en el AppDomain
if (-not ([System.Management.Automation.PSTypeName]'TocinetaSonrie.Hardware.RawPrinterHelper').Type) {
    try {
        Add-Type -TypeDefinition $cSharpCode -Language CSharp
    } catch {
        Write-Error "Error compilando clase RawPrinterHelper: $_"
        exit 1
    }
}

# Obtener los bytes según los parámetros
[byte[]]$payloadBytes = $null

if (![string]::IsNullOrEmpty($FilePath)) {
    if (-not (Test-Path -Path $FilePath)) {
        Write-Error "El archivo especificado no existe: $FilePath"
        exit 2
    }
    try {
        $payloadBytes = [System.IO.File]::ReadAllBytes($FilePath)
    } catch {
        Write-Error "Error leyendo archivo binario ($FilePath): $_"
        exit 3
    }
} elseif (![string]::IsNullOrEmpty($Base64Data)) {
    try {
        $payloadBytes = [System.Convert]::FromBase64String($Base64Data)
    } catch {
        Write-Error "Error decodificando cadena Base64: $_"
        exit 4
    }
} else {
    Write-Error "Debe proporcionar -FilePath o -Base64Data con los bytes ESC/POS."
    exit 6
}

try {
    $written = [TocinetaSonrie.Hardware.RawPrinterHelper]::SendBytes($PrinterName, $payloadBytes, $DocName)
    $result = [PSCustomObject]@{
        Success      = $true
        PrinterName  = $PrinterName
        DocName      = $DocName
        BytesSent    = $payloadBytes.Length
        BytesWritten = $written
        Timestamp    = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    }
    Write-Output ($result | ConvertTo-Json -Compress)
    exit 0
} catch {
    $errObj = [PSCustomObject]@{
        Success      = $false
        PrinterName  = $PrinterName
        DocName      = $DocName
        ErrorMessage = $_.Exception.Message
        Timestamp    = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    }
    [Console]::Error.WriteLine(($errObj | ConvertTo-Json -Compress))
    exit 10
}
