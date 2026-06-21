export interface FilterItem {
  label: string;
  value: string;
}

export interface FilterSection {
  key: string;
  label: string;
  items: FilterItem[];
  value: string;
  display: string;
  onSelect: (v: string) => void;
  onClear: () => void;
}
