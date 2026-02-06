interface Props {
  currentStage: number;
}

function OrderProgressBar({ currentStage }: Props) {
  const totalStages = 8;
  const progress = ((currentStage - 1) / (totalStages - 1)) * 100;
  return (
    <div className="flex items-center w-full max-w-xs">
      <div className="flex-1 relative">
        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-blue-500 to-blue-600 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
        <div className="absolute inset-0 flex justify-between items-center">
          {Array.from({ length: totalStages }).map((_, index) => (
            <div key={index} className={`w-2 h-2 rounded-full ${index < currentStage ? 'bg-blue-500' : 'bg-gray-300'}`} />
          ))}
        </div>
      </div>
      <span className="ml-3 text-xs font-medium text-gray-500">{currentStage}/{totalStages}</span>
    </div>
  );
}

export default OrderProgressBar;
