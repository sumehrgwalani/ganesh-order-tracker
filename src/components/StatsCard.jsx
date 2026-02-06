import React from 'react';
import Icon from './Icon';

function StatsCard({ title, value, highlight, onClick, trend, icon }) {
  return (
    <div onClick={onClick} className={`p-5 rounded-2xl cursor-pointer transition-all hover:shadow-lg hover:-translate-y-1 ${highlight ? 'bg-gradient-to-br from-blue-600 to-blue-700 text-white' : 'bg-white border border-gray-100'}`}>
      <div className="flex justify-between items-start">
        <div>
          <p className={`text-sm font-medium ${highlight ? 'text-blue-100' : 'text-gray-500'}`}>{title}</p>
          <p className="text-3xl font-bold mt-2">{value}</p>
          {trend && <p className={`text-xs mt-2 ${highlight ? 'text-blue-200' : 'text-green-600'}`}>{trend}</p>}
        </div>
        {highlight && <button className="bg-white/20 p-2 rounded-xl hover:bg-white/30"><Icon name="Plus" size={18} /></button>}
      </div>
      <p className={`text-sm mt-3 font-medium ${highlight ? 'text-blue-100' : 'text-blue-600'}`}>View All →</p>
    </div>
  );
}

export default StatsCard;
