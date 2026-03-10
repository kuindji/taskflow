function isElectron(): boolean {
  return typeof window !== 'undefined' && 'taskflow' in window;
}

const electron = isElectron();

function useIsElectron(): boolean {
  return electron;
}

export default useIsElectron;
