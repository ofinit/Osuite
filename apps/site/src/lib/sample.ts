// The demo invoice on the home page: a fictitious Pune supplier and three customers in three states.
export const SAMPLE = {
  seller: { name: 'Shree Ganesh Industrial Supplies', place: 'MIDC Bhosari, Pune', state: '27', gstin: '27AAPFU0939F1ZV' },
  buyers: {
    '27': { name: 'Kalyani Forge Components', place: 'Chakan, Pune', state: 'Maharashtra' },
    '29': { name: 'Karnataka Components Pvt Ltd', place: 'Bengaluru', state: 'Karnataka' },
    '24': { name: 'Sabarmati Fabricators', place: 'Ahmedabad', state: 'Gujarat' },
  },
  item: { description: 'Hex bolt M10 x 50, zinc plated', hsn: '73181500', uom: 'NOS' },
  start: { buyer: '29', qty: '500', rate: '14', gstRate: '18', discount: '0' },
} as const;
