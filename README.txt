This is the first functionality-complete release of the Sencha Touch list 
component extension I and others have been working on in this thread:

http://www.sencha.com/forum/showthre...dation-thread/

Ext.ux.BufferedList is designed to be used in place of the standard Ext.List 
component, and supports essentially all Ext.List functions and configuration 
parameters, while providing the following enhancements and changes:

- Adequate scrolling performance with large data sets. The attached examples 
  use a data array of about 1400 items, while still providing similar scroll 
  performance to Ext.List. This is accomplished by rendering a "sliding window"
  of list items based on current scroll position, rather than rendering all 
  list items.
- Independent support for indexBar and group headers. By setting the standard 
  list config parameter "grouped" to true, and the extension config parameter 
  useGroupHeaders to false, you can use an index bar without having group 
  headers, as some native iOS applications do. Obviously, setting 
  useGroupHeaders to true gives you standard group headers.
- The configuration parameter "blockScrollSelect" is provided. If set to 
  true, this prevents item selection while the list is still scrolling, 
  so you can tap the list to stop scroll without invoking a selection - 
  again, similar to native iOS. See the attached examples.

The only non-intuitive configuration is a parameter called "maxItemHeight". 
This is set at 85 pixels by default. If you have a significant number of 
items in the list which will be greater than this height, you should increase 
the value at least to the 90th percentile or so item height, to avoid 
potential problems with long scrolls to the top of the list. Also, itemTpl 
should be specified only as a string, not as an XTemplate, although this 
restriction may be removed soon.

I've licensed this work under either GPL or MIT, which I believe should 
allow for any forseeable reuse.

Please let me know of any bugs, enhancements, etc.

The repository contains both the UxBufList.js file, and a samples directory
demonstrating regular, indexBar, and grouped with headers lists. There are also
samples of three fixed bugs reported on this thread:

http://www.sencha.com/forum/showthread.php?121225-High-Performance-Large-List-component-UxBufferedList

You will need to edit the html files to point to your sencha touch library for
the samples to work.

The version currently in the repository is version .14, the same as the last
version provided in the zip file at the above mentioned Sencha forum thread.