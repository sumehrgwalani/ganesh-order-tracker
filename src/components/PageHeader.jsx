import React from 'react';
import Icon from './Icon';

function PageHeader({ title, subtitle, onBack, actions }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-4 mb-2">
        {onBack && (
          <button onClick={onBack} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <Icon name="ChevronRight" size={20} className="rotate-180 text-gray-500" />
          </button>
        )}
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-800">{title}</h1>
          {subtitle && <p className="text-gray-500 mt-1">{subtitle}</p>}
        </div>
        {actions && <div className="flex gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export default PageHeader;
