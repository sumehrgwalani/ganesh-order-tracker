import { Order, OrderStage } from '../types';
import Icon from './Icon';
import { ORDER_STAGES } from '../data/constants';

interface Props {
  selectedStage: number | null;
  onStageSelect: (stage: number | null) => void;
  orders: Order[];
  stages?: OrderStage[];
}

interface Stage {
  id: number;
  name: string;
  shortName: string;
  description: string;
  color: string;
}

function StageFilter({ selectedStage, onStageSelect, orders, stages: stagesProp }: Props) {
  const stages = (stagesProp || ORDER_STAGES) as Stage[];
  
  // Count orders at each stage
  const stageCounts = stages.reduce((acc: Record<number, number>, stage) => {
    acc[stage.id] = orders.filter(o => o.currentStage === stage.id).length;
    return acc;
  }, {});

  const totalOrders = orders.length;

  const getStageColors = (stageId: number, isSelected: boolean) => {
    const colors: Record<number, string> = {
      1: isSelected ? 'bg-blue-600 text-white border-blue-600' : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 hover:border-blue-300',
      2: isSelected ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100 hover:border-indigo-300',
      3: isSelected ? 'bg-purple-600 text-white border-purple-600' : 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100 hover:border-purple-300',
      4: isSelected ? 'bg-pink-600 text-white border-pink-600' : 'bg-pink-50 text-pink-700 border-pink-200 hover:bg-pink-100 hover:border-pink-300',
      5: isSelected ? 'bg-orange-600 text-white border-orange-600' : 'bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100 hover:border-orange-300',
      6: isSelected ? 'bg-amber-600 text-white border-amber-600' : 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 hover:border-amber-300',
      7: isSelected ? 'bg-teal-600 text-white border-teal-600' : 'bg-teal-50 text-teal-700 border-teal-200 hover:bg-teal-100 hover:border-teal-300',
      8: isSelected ? 'bg-green-600 text-white border-green-600' : 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100 hover:border-green-300',
    };
    return colors[stageId] || 'bg-gray-50 text-gray-700 border-gray-200';
  };

  return (
    <div className="bg-gray-50 rounded-xl p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">ORDER LIFECYCLE STAGES</p>
        {selectedStage && (
          <button
            onClick={() => onStageSelect(null)}
            className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
            aria-label="Clear stage filter"
          >
            <Icon name="X" size={12} />
            Clear filter
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {/* All Orders button */}
        <button
          onClick={() => onStageSelect(null)}
          className={`text-xs px-3 py-2 rounded-lg border-2 transition-all cursor-pointer flex items-center gap-2 ${
            selectedStage === null
              ? 'bg-gray-800 text-white border-gray-800'
              : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100 hover:border-gray-300'
          }`}
          aria-label={`All orders (${totalOrders})`}
        >
          <span className="font-medium">All</span>
          <span className={`px-1.5 py-0.5 rounded-full text-xs ${selectedStage === null ? 'bg-white/20' : 'bg-gray-200'}`}>
            {totalOrders}
          </span>
        </button>

        {/* Stage buttons */}
        {stages.map((stage, i) => {
          const isSelected = selectedStage === stage.id;
          const count = stageCounts[stage.id] || 0;
          const hasOrders = count > 0;

          return (
            <button
              key={stage.id}
              onClick={() => onStageSelect(stage.id)}
              disabled={!hasOrders}
              className={`text-xs px-3 py-2 rounded-lg border-2 transition-all cursor-pointer flex items-center gap-2 ${
                hasOrders
                  ? getStageColors(stage.id, isSelected)
                  : 'bg-gray-100 text-gray-400 border-gray-100 cursor-not-allowed opacity-60'
              }`}
              title={`${stage.description}${hasOrders ? ` (${count} order${count > 1 ? 's' : ''})` : ' (no orders)'}`}
              aria-label={`Filter by ${stage.name}${hasOrders ? ` (${count} order${count > 1 ? 's' : ''})` : ' (no orders)'}`}
            >
              <span className={`font-semibold ${isSelected ? 'text-white/80' : ''}`}>{i + 1}.</span>
              <span className="font-medium">{stage.name}</span>
              {hasOrders && (
                <span className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${
                  isSelected ? 'bg-white/30' : 'bg-white'
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Selected stage info */}
      {selectedStage && (
        <div className="mt-3 pt-3 border-t border-gray-200">
          <div className="flex items-center gap-2">
            <span className={`w-3 h-3 rounded-full bg-${ORDER_STAGES[selectedStage-1]?.color || 'blue'}-500`}></span>
            <span className="text-sm font-medium text-gray-700">
              Showing {stageCounts[selectedStage]} order{stageCounts[selectedStage] !== 1 ? 's' : ''} at stage "{ORDER_STAGES[selectedStage-1]?.name}"
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1 ml-5">{ORDER_STAGES[selectedStage-1]?.description}</p>
        </div>
      )}
    </div>
  );
}

export default StageFilter;
