interface DownloadButtonProps {
  onClick: () => void
  disabled?: boolean
}

function DownloadButton({ onClick, disabled }: DownloadButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        w-full py-4 rounded-xl
        font-semibold text-lg
        transition-all duration-200
        flex items-center justify-center gap-2
        ${disabled
          ? 'bg-neutral-700 text-neutral-500 cursor-not-allowed'
          : 'bg-primary-600 hover:bg-primary-500 text-white active:scale-[0.98]'
        }
      `}
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
      </svg>
      Download MP3
    </button>
  )
}

export default DownloadButton
