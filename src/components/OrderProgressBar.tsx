interface Props {
  currentStage: number;
  skippedStages?: number[];
}

function OrderProgressBar({ currentStage, skippedStages = [] }: Props) {
  const totalStages = 9;
  const isComplete = currentStage >= totalStages;
  const progress = ((currentStage - 1) / (totalStages - 1)) * 100;
  const barColor = isComplete ? 'from-green-500 to-green-600' : 'from-blue-500 to-blue-600';
  const textColor = isComplete ? 'text-green-600 font-semibold' : 'text-gray-500';

  return (
    <div className="flex items-center w-full max-w-xs">
      <div className="flex-1 relative">
        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div className={`h-full bg-gradient-to-r ${barColor} rounded-full transition-all duration-500`} style={{ width: `${progress}%` }} />
        </div>
        <div className="absolute inset-0 flex justify-between items-center">
          {Array.from({ length: totalStages }).map((_, index) => {
            const stageNum = index + 1;
            const isSkipped = skippedStages.includes(stageNum) && stageNum < currentStage;
            const isPassed = stageNum <= currentStage && !isSkipped;
            const dotColor = isSkipped
              ? 'bg-red-400'
              : isPassed
                ? (isComplete ? 'bg-green-500' : 'bg-blue-500')
                : 'bg-gray-300';
            return <div key={index} className={`w-2 h-2 rounded-full ${dotColor}`} />;
          })}
        </div>
      </div>
      <span className={`ml-3 text-xs font-medium ${textColor}`}>{currentStage}/{totalStages}</span>
    </div>
  );
}

export default OrderProgressBar;
