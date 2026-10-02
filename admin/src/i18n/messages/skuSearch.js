/**
 * Strings owned by the shared SKU / barcode autocomplete.
 *
 * Both of these were written straight into the component in
 * Vietnamese, so an operator on English saw Vietnamese in every page
 * that embeds it -- nine of them. The DOM sweep could not have fixed
 * that: it only ever translated in the other direction.
 */

export const en = {
  'skuSearch.placeholderMin2': 'Type or scan a SKU / barcode (at least 2 characters)',
  'skuSearch.noMatch': 'No SKU or barcode matches “{query}”.',
  'skuSearch.placeholder': 'Type or scan a SKU / barcode…',
};

export const vi = {
  'skuSearch.placeholderMin2': 'Gõ hoặc scan SKU / barcode (tối thiểu 2 ký tự)',
  'skuSearch.noMatch': 'Không tìm thấy SKU/barcode khớp “{query}”.',
  'skuSearch.placeholder': 'Gõ hoặc scan SKU / barcode…',
};
