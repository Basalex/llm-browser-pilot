Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
serverScript = fso.BuildPath(baseDir, "bridge\server.js")

shell.CurrentDirectory = baseDir
cmd = "node """ & serverScript & """"
shell.Run cmd, 0, False
