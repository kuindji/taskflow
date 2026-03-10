import { DialogHost } from '@/components/DialogHost';

export function App() {
  return (
    <>
      <DialogHost />
      <div className="bg-background text-foreground h-screen flex items-center justify-center">
        <h1>Taskflow</h1>
      </div>
    </>
  );
}
