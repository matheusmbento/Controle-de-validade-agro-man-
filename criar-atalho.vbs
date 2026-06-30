Set oWS = WScript.CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Pega a pasta atual onde o sistema esta salvo
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)

' Configura a criacao na Area de Trabalho
sLinkFile = oWS.SpecialFolders("Desktop") & "\Sistema Agro Mane.lnk"
Set oLink = oWS.CreateShortcut(sLinkFile)

' Define as propriedades do atalho
oLink.TargetPath = currentDir & "\iniciar.bat"
oLink.WorkingDirectory = currentDir
oLink.IconLocation = currentDir & "\icone.ico, 0"
oLink.WindowStyle = 7 ' 7 = Iniciar Minimizado
oLink.Save

WScript.Echo "Atalho 'Sistema Agro Mane' criado na Area de Trabalho com sucesso!"