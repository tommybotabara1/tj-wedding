/* When does a list item's action area (Remove, Try again, the confirm) need
   rebuilding? Only when this signature changes. Upload progress changes the
   status text and the bar, never this, so a tap or an open confirm is not
   torn down by a progress event or a poll. */
export function actionsKey(item, retryable) {
  return [item.state, item.entry || '', item.key || '', retryable ? 'retry' : ''].join('|');
}
