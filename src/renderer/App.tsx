import { Terminal, FileText, ClipboardList, Settings } from 'lucide-react'

function App() {
  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
          <Terminal className="h-6 w-6 text-blue-500" />
          Dev Toolbox
        </h1>
        <p className="text-gray-500">Electron + React + Vite + TypeScript desktop application</p>
      </header>

      <main className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card title="Open Directory" icon={<FileText className="h-5 w-5 text-blue-500" />}>
          Open a folder to browse files.
        </Card>
        <Card title="Read File" icon={<ClipboardList className="h-5 w-5 text-green-500" />}>
          Read file contents from disk.
        </Card>
        <Card title="Write File" icon={<Settings className="h-5 w-5 text-purple-500" />}>
          Write content to a file.
        </Card>
        <Card title="Clipboard" icon={<ClipboardList className="h-5 w-5 text-orange-500" />}>
          Copy text to clipboard.
        </Card>
      </main>
    </div>
  )
}

interface CardProps {
  title: string
  icon: React.ReactElement
  children: React.ReactNode
}

function Card({ title, icon, children }: CardProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <span className="font-semibold text-gray-800">{title}</span>
      </div>
      <p className="text-sm text-gray-600">{children}</p>
    </div>
  )
}

export default App
