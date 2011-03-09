/*
 * 
 * Author: Scott Borduin, Lioarlan, LLC
 * License: GPL (http://www.gnu.org/licenses/gpl.html) -or- MIT (http://www.opensource.org/licenses/mit-license.php)
 * 
 * Release: 0.15
 * 
 * Acknowledgement: Based partly on public contributions from members of the Sencha.com bulletin board.
 * 
 */

Ext.namespace('Ext.ux');

Ext.ux.BufferedList = Ext.extend(Ext.List, {

	// minimum number of items to be rendered at all times.
	minimumItems: 50,
	
	// number of items to render incrementally when scrolling past
	// top or bottom of currently rendered items.
	batchSize: 50,
	
	// maximum number of items to be rendered before cleanup is
	// triggered on scrollStop. Must be > batchSize.
	cleanupBoundary: 125,
	
	// if this is true, block item selection while the list is still scrolling
	blockScrollSelect: false,
	
	// this is a reasonable default, but still better to define it in config parameters
	maxItemHeight: 85,
	
	// override
	initComponent: function() {
		this.itemTplDelayed = new Ext.XTemplate('<div class="x-list-item"><div class="x-list-item-body">' + this.itemTpl + '</div></div>').compile();
		
		Ext.ux.BufferedList.superclass.initComponent.call(this);

		// new template which will only be used for our proxies
		this.tpl = new Ext.XTemplate([
			'<tpl for=".">',
				'<div class="{id}"></div>',
			'</tpl>'
		]);
		
		// Member variables to hold indicies of first and last items rendered.
		this.topItemRendered = 0;
		this.bottomItemRendered = 0;

		// cleanup task to be invoked on scroll stop.
		this.cleanupTask = new Ext.util.DelayedTask(this.itemCleanup,this);
		
		// flag used to make sure we don't collide with the cleanup thread
		this.isUpdating = false;
	
		// variables used to store state for group header display
		this.headerText = '';
		this.groupHeaders = [];

		// make sure grouping flags consistently initialized
		if ( this.useGroupHeaders === undefined ) {
			this.useGroupHeaders = this.grouped;
		}
		else {
			this.grouped = this.grouped || this.useGroupHeaders;
		}
		
	},
	

	// don't handle all records, but only return three: top proxy, container, bottom proxy
	// actual content will be rendered to the container element in the scroll event handler
	collectData: function(records, startIndex) {
		return [{
			id: 'ux-list-top-proxy'
		},{
			id: 'ux-list-container'
		},{
			id: 'ux-list-bottom-proxy'
		}];
	},
	
	// @private - override so we can remove base class scroll event handlers
	initEvents: function() {
		Ext.ux.BufferedList.superclass.initEvents.call(this);
		// Remove listeners added by base class, these are all overridden
		// in this implementation.
        this.mun(this.scroller, {
            scrollstart: this.onScrollStart,
            scroll: this.onScroll,
            scope: this
        });
        
        // monitor for hide events, to stop scrolling when hide is called
        this.mon(this,
        	{beforehide:this.onBeforeHide}
        );

	},
	
	// @private - override of refresh from DataView.
	refresh: function() {

		// DataView.refresh renders our proxies and list container
		Ext.ux.BufferedList.superclass.refresh.apply(this,arguments);

		// locate our proxy and list container nodes
		this.topProxy = this.getTargetEl().down('.ux-list-top-proxy');
		
		this.bottomProxy = this.getTargetEl().down('.ux-list-bottom-proxy');

		this.listContainer = this.getTargetEl().down('.ux-list-container');

		// if our store is not yet filled out, do nothing more
		if ( this.store.getCount() === 0 ) {
			return;
		}
				
		// if this is a grouped list, initialize group index map
		if (this.grouped) {
			this.initGroupIndexMap();
			this.groupHeaders = [];
		}

		// show & buffer first items in the list
		this.topProxy.setHeight(0);
		this.bottomProxy.setHeight(this.store.getCount() * this.maxItemHeight);
		this.renderOnScroll(0); // renders first this.minimumItems nodes in store
		
	},

	// @private - override
	afterRender: function() {
		Ext.ux.BufferedList.superclass.afterRender.apply(this,arguments);

		// set up listeners which will trigger rendering/cleanup of our sliding window of items
		this.mon(this.scroller,{
			scroll: this.renderOnScroll,
			scrollend: this.onScrollStop,
			scope: this
		});

	},

	// @private - queue up tasks to perform on scroll end
	onScrollStop: function() {

		// prevents the list from selecting an item if the user just taps to stop the scroll
		if ( this.blockScrollSelect ) {
			this.selModel.setLocked(true);
			Ext.defer(this.unblockSelect,100,this);
		}
		// Queue cleanup task.
		// The reason this is a delayed task, rather a direct execution, is that
		// scrollend fires when the user merely flicks the list for further scrolling.
		this.cleanupTask.delay(250);
	},

	// @private - delayed task function to resume selection after scroll end
	unblockSelect: function() {
		this.selModel.setLocked(false);
	},
	
	// check if index of store record corresponds to a currently rendered item
	isItemRendered: function(index) {
		// Trivial check after first render
		return this.all.elements.length > 0 ?
			index >= this.topItemRendered && index <= this.bottomItemRendered : false;
	},

	// return array of list item nodes actually visible. If returnAsIndexes is true,
	// this will be an array of record indexes, otherwise it will be an
	// array of nodes.
	getVisibleItems: function(returnAsIndexes) {
		var startPos = this.scroller.getOffset().y;
		var elems = this.all.elements, 
			nElems = elems.length,
			returnArray = [],
			thisHeight = this.height,
			node,
			offTop,
			i;
		for ( i = 0; i < nElems; i++ ){
			node = elems[i];
			offTop = node.offsetTop + node.offsetHeight;
			if ( offTop > startPos ) {
				returnArray.push(returnAsIndexes ? node.viewIndex : node);
				if ( offTop - startPos > thisHeight ) {
					break;
				}
			}
		}
		return returnArray;
	},
	
	// @private - render items into sliding window
	renderOnScroll: function(startRecord) { // startRecord optional

		// cancel any cleanups pending from a scrollstop
		this.cleanupTask.cancel();
		
		// if we're still executing a cleanup task, or add/remove/replace, wait
		// for the next call
		if ( this.isUpdating ) {
			return 0;
		}
	
		if ( this.debugFlag ) {
			this.isUpdating = false;
		}
		
		var scrollPos = this.scroller.getOffset().y;

		var newTop = null, 
			newBottom = null, 
			previousTop = this.topItemRendered, 
			previousBottom = this.bottomItemRendered,
			scrollDown = false,
			incrementalRender = false,
			maxIndex = this.store.getCount() - 1;
			

		if ( Ext.isNumber(startRecord) ) {
			if ( startRecord < 0 || startRecord > maxIndex ) {
				return 0; // error
			}
			newTop = startRecord;
			newBottom = Math.min((startRecord + this.minimumItems) - 1,maxIndex);
			scrollDown = true;
			incrementalRender = false;
		}
		else {
			var thisHeight = this.height;
			// position of top of list relative to top of visible area (+above, -below)
			var listTopMargin = scrollPos - this.topProxy.getHeight();
			// position of bottom of list relative to bottom of visible area (+above, -below)
			var listBottomMargin = (scrollPos + thisHeight) - (this.topProxy.getHeight() + this.listContainer.getHeight());
			// scrolled into "white space"
			if ( listTopMargin <= -thisHeight || listBottomMargin >= thisHeight ) {
				incrementalRender = false;
				scrollDown = true;
				newTop = Math.max( (Math.floor(scrollPos/this.maxItemHeight)-1), 0 );
				newBottom = Math.min((newTop + this.minimumItems) - 1,maxIndex);
			}
			// about to scroll off top of list
			else if ( listTopMargin < 50 && this.topItemRendered > 0 ) {
				newTop = Math.max(this.topItemRendered - this.batchSize,0);
				newBottom = previousBottom;
				scrollDown = false;
				incrementalRender = true;
			}
			// about to scroll off bottom of list
			else if ( listBottomMargin > -50 ) {
				newTop = previousTop;
				newBottom = Math.min(previousBottom + this.batchSize,maxIndex);
				scrollDown = true;
				incrementalRender = true;
			}
		}

		// no need to render anything?
		if ( (newTop === null || newBottom === null) || 
			 (incrementalRender && newTop >= previousTop && newBottom <= previousBottom) ) {
			// still need to update list header appropriately
			if ( this.useGroupHeaders && this.pinHeaders ) {
				this.updateListHeader(scrollPos);
			}
			return 0;
		}
		
		var startIdx, nItems = 0;
		// Jumped past boundaries of currently rendered items? Replace entire item list.
		if (this.bottomItemRendered === 0 || !incrementalRender) {
			// new item list starting with newTop
			nItems = this.replaceItemList(newTop,this.minimumItems);		
		}
		// incremental - scrolling down
		else if(scrollDown) {
			startIdx = previousBottom + 1;
			nItems = this.appendItems(startIdx,this.batchSize);
		}
		// incremental - scrolling up
		else {
			startIdx = Math.max(previousTop - 1,0);
			nItems = this.insertItems(startIdx,this.batchSize);
			// collapse top proxy to zero if we're actually at the top.
			// This causes a minor behavioral glitch when the top proxy has
			// non-zero height - the list stops momentum at the top instead of
			// bouncing. But this only occurs when navigating into the middle
			// of the list, then scrolling all the way back to the top, and
			// doesn't prevent any other functionality from working. It could
			// probably be worked around with enough creativity ...
			if ( newTop === 0 ) {
				this.topProxy.setHeight(0);
				this.scroller.updateBoundary();
				this.scroller.suspendEvents();
				this.scroller.scrollTo({x:0,y:0});
				this.scroller.resumeEvents();
			}
		}

		// zero out bottom proxy if we're at the bottom ...
		if ( newBottom === maxIndex ) {
			var bottomPadding = this.height - this.listContainer.getHeight();
			this.bottomProxy.setHeight(bottomPadding > 0 ? bottomPadding : 0);
		}

		// update list header appropriately
		if ( this.useGroupHeaders && this.pinHeaders ) {
			this.updateListHeader(this.scroller.getOffset().y);
		}

		return nItems;
	},

	// @private
	updateListHeader: function(scrollPos) {
		scrollPos = scrollPos || this.scroller.getOffset().y;
		
		// List being "pulled down" at top of list. Hide header.
		if ( scrollPos <= 0 && this.headerText ) {
			this.updateHeaderText(false);
			return;
		}

		// work backwards through groupHeaders until we find the
		// first one at or above the top of the viewable items.
		this.headerHeight = this.headerHeight || this.header.getHeight();
		var i, 
			headerNode,
			nHeaders = this.groupHeaders.length, 
			headerMoveTop = scrollPos + this.headerHeight,
			groupTop,
			transform,
			headerText;
		for ( i = nHeaders - 1; i >= 0; i-- ) {
			headerNode = this.groupHeaders[i];
			groupTop = headerNode.offsetTop;
			if ( groupTop < headerMoveTop ) {
				// group header "pushing up" or "pulling down" on list header
				if (groupTop > scrollPos) {
					this.transformedHeader = true;
					transform = (scrollPos + this.headerHeight) - groupTop;
           			Ext.Element.cssTranslate(this.header, {x: 0, y: -transform});
					// make sure list header text displaying previous group
           			this.updateHeaderText(this.getPreviousGroup(headerNode.innerHTML).toUpperCase());
           		}
				else {
					this.updateHeaderText(headerNode.innerHTML);
					if ( this.transformedHeader ) {
						this.header.setStyle('-webkit-transform', null);
						this.transformedHeader = false;
					}
				}
				break;
			}
		}
		// if we never got a group header above the top of the list, make sure
		// list header represents previous group text
		if ( i < 0 && headerNode ) {
			this.updateHeaderText(this.getPreviousGroup(headerNode.innerHTML).toUpperCase());
			if ( this.transformedHeader ) {
				this.header.setStyle('-webkit-transform', null);
				this.transformedHeader = false;
			}
		}
	},
	
	// @private
	updateHeaderText: function(groupString) {
		if ( !groupString ) {
			this.header.hide();
			this.headerText = groupString;
		}
		else if ( groupString !== this.headerText ){
			this.header.update(groupString);
			this.header.show();
			this.headerText = groupString;
		}
	},
	
	// @private
	itemCleanup: function() {
		// item cleanup just replaces the current item list with a new, shortened
		// item list. This is much faster than actually removing existing item nodes
		// one by one.
		if ( this.all.elements.length > this.cleanupBoundary ) {
			this.updateItemList();
		}
	},


	// used by insertItems, appendItems, replaceItems. Builds HTML to add
	// to list container. Inserts group headers as appropriate.
	// @private
	buildItemHtml: function(firstItem,lastItem) {
		// loop over records, building up html string
		var i, 
			htm = '',
			store = this.store,
			tpl = this.itemTplDelayed,
			grpHeads = this.useGroupHeaders,
			record,
			groupId; 
		for ( i = firstItem; i <= lastItem; i++ ) {
			record = store.getAt(i);
			if ( grpHeads ) {
				groupId = store.getGroupString(record);
				if ( i === this.groupStartIndex(groupId) ) {
					htm += ('<h3 class="x-list-header">' + groupId.toUpperCase() + '</h3>');
				}
			}
			htm += tpl.applyTemplate(record.data);
		}
		return htm;
	},
	
	// @private - Replace current contents of list container with new item list
	replaceItemList: function(firstNew,nItems) {
		var sc = this.store.getCount();
		if ( firstNew >= sc ) {
			return 0;
		}
		else if ( firstNew + nItems > sc ) {
			nItems = sc - firstNew;
		}

		// See if the first item is currently rendered. If so, save the
		// exact offset top position so we can recreate it. Otherwise, calculate
		// new proxy size.
		var topProxyHeight, 
			firstNode = this.getNode(firstNew);
		if ( firstNode ) {
			topProxyHeight = firstNew === 0 ? 0 : firstNode.offsetTop;
		}
		else {
			topProxyHeight = firstNew * this.maxItemHeight;
		}
		
		var bottomProxyHeight = (sc - firstNew) * this.maxItemHeight;

		// build html string
		var lastNew = (firstNew + nItems) - 1;
		var htm = this.buildItemHtml(firstNew,lastNew);

		// replace listContainer internals with new html
		this.all.elements.splice(0);
		this.groupHeaders.splice(0);
		this.listContainer.update(htm);

		// append our new nodes to the elements array
		var nodes = this.listContainer.dom.childNodes, 
			nodelen = nodes.length, 
			firstIndex = firstNew,
			newNode,
			tagName;
		for ( var i = 0; i < nodelen; i++ ) {
			newNode = nodes[i];
			tagName = newNode.tagName;
			if ( tagName === 'DIV') {
				newNode.viewIndex = firstIndex++;
				this.all.elements.push(newNode);
			}
			else if ( tagName === 'H3') {
				this.groupHeaders.push(newNode);
			}
		}
		
		// reset proxy heights, and save indicies of first and last items rendered
		this.topProxy.setHeight(topProxyHeight);
		this.bottomProxy.setHeight(bottomProxyHeight - this.listContainer.getHeight());
		this.topItemRendered = firstNew;
		this.bottomItemRendered = lastNew;
		
		return nItems;
	},

	// Append a chunk of items to list container. Return number of items appended. 
	// @private
	appendItems: function(firstNew,nItems) {
		// check to make sure parameters in bounds
		var sc = this.store.getCount();
		if ( firstNew >= sc ) {
			return 0;
		}
		else if ( firstNew + nItems > sc ) {
			nItems = sc - firstNew;
		}

		// save current bottom of list, so we know where to start
		// to find our new nodes.
		var oldLastChild = this.listContainer.dom.lastChild;

		// save current list container height
		var oldListHeight = this.listContainer.getHeight();

		// build html string
		var lastNew = (firstNew + nItems) - 1;
		var htm = this.buildItemHtml(firstNew,lastNew);

		// append new nodes
		Ext.DomHelper.insertHtml('beforeEnd',this.listContainer.dom,htm);

		// append our new nodes to the elements array
		var tagName, newNode = oldLastChild ? oldLastChild.nextSibling : this.listContainer.dom.firstChild;
		while ( newNode ) {
			tagName = newNode.tagName;
			if ( tagName === 'DIV') {
				newNode.viewIndex = firstNew++;
				this.all.elements.push(newNode);
			}
			else if ( tagName === 'H3') {
				this.groupHeaders.push(newNode);
			}
			newNode = newNode.nextSibling;
		}

		// recalculate bottom proxy height, and save index of last item rendered
		this.bottomProxy.setHeight(this.bottomProxy.getHeight() - (this.listContainer.getHeight() - oldListHeight));
		this.bottomItemRendered = lastNew;
		return nItems;
	},

	// Insert a chunk of items at top of list container. Return number of items inserted.
	insertItems: function(firstNew,nItems) {
		// check to make sure parameters in bounds
		if ( firstNew < 0 ) {
			return 0;
		}
		else if ( firstNew - nItems < 0 ) {
			nItems = firstNew + 1;
		}

		// save current top of list, so we know where to start
		// to find our new nodes.
		var oldFirstChild = this.listContainer.dom.firstChild;
		
		// save current list container height
		var oldListHeight = this.listContainer.getHeight();

		// build html string
		var lastNew = (firstNew - nItems) + 1;
		var htm = this.buildItemHtml(lastNew,firstNew);

		// insert new nodes
		Ext.DomHelper.insertHtml('afterBegin',this.listContainer.dom,htm);

		// insert our new nodes into the elements array
		var tagName, newNode = oldFirstChild ? oldFirstChild.previousSibling : this.listContainer.dom.lastChild;
		while ( newNode ) {
			tagName = newNode.tagName;
			if ( tagName === 'DIV') {
				newNode.viewIndex = firstNew--;
				this.all.elements.unshift(newNode);
			}
			else if ( tagName === 'H3') {
				this.groupHeaders.unshift(newNode);
			}
			newNode = newNode.previousSibling;
		}

		// recalculate top proxy height, and save index of first item rendered
		var newHeight = this.topProxy.getHeight() - (this.listContainer.getHeight() - oldListHeight);
		this.topProxy.setHeight(lastNew === 0 ? 0 : Math.max(newHeight,0) );
		this.topItemRendered = lastNew;
		
		return nItems;
	},
	
	// @private - create a map of grouping strings to start index of the groups
	initGroupIndexMap: function() {
		this.groupIndexMap = {};
		var i, 
			key,
			firstKey,
			store = this.store, 
			recmap = {},
			groupMap = this.groupIndexMap,
			prevGroup = '',
			sc = store.getCount();

		// build temporary map of group string to store index from store records
		for ( i = 0; i < sc; i++ ) {
            key = escape(store.getGroupString(store.getAt(i)).toLowerCase());
			if ( recmap[key] === undefined ) {
				recmap[key] = { index: i, closest: key, prev: prevGroup } ;
				prevGroup = key;
			}
			if ( !firstKey ) {
				firstKey = key;
			}
		}

		// now make sure our saved map has entries for every index string
		// in our index bar, if we have a bar.
        if (!!this.indexBar) {
			var barStore = this.indexBar.store, 
				bc = barStore.getCount(), 
				grpid, 
				idx = 0,
				recobj;
				prevGroup = '',
				key = '';
        	for ( i = 0; i < bc; i++ ) {
				grpid = barStore.getAt(i).get('key').toLowerCase();
				recobj = recmap[grpid];
				if ( recobj ) {
					idx = recobj.index;
					key = recobj.closest;
					prevGroup = recobj.prev;
				}
				else if ( !key ) {
					key = firstKey;
				}
				groupMap[grpid] = { index: idx, closest: key, prev: prevGroup };
			}
        }
        else {
            this.groupIndexMap = recmap;
        }		
	},
	
    // @private - get an encoded version of the string for use as a key in the hash 
    getKeyFromId: function (groupId){
        return escape(groupId.toLowerCase());
    },
     // @private - get the group object corresponding to the given id
    getGroupObj:function (groupId){
        return this.groupIndexMap[this.getKeyFromId(groupId)];
    },
    
    // @private - get starting index of a group by group string
    groupStartIndex: function(groupId) {
        return this.getGroupObj(groupId).index;
    },
    
    
    // @private - get group preceding the one in groupId
    getPreviousGroup: function(groupId) {
        
        return this.getGroupObj(groupId).prev;
    },
    
    // @private - get closest non-empty group to specified groupId from indexBar
    getClosestGroupId: function(groupId) {
        return this.getGroupObj(groupId).closest;
    },

    // @private
	indexOfRecord: function(rec) {
		// take advantage of group map to speed up search for record index. Speeds up
		// selection slightly.
		var idx = -1, store = this.store, sc = store.getCount();
		if ( this.grouped ) {
			for ( idx = this.groupStartIndex(store.getGroupString(rec)); idx < sc; idx++ ) {
				if ( store.getAt(idx) === rec ) {
					break;
				}
			}
		}
		else {
			idx = this.store.indexOf(rec)
		}
		return idx;
	},
	
	// @private - respond to indexBar touch.
	onIndex: function(record, target, index) {

		// get first item of group from map
		var grpId = record.get('key').toLowerCase();
		var firstItem = this.groupStartIndex(grpId);

		// render new list of items into list container
		if ( Ext.isNumber(firstItem) && this.renderOnScroll(firstItem) > 0 ) {
			// Set list header text to reflect new group.
			if ( this.useGroupHeaders && this.pinHeaders ) {
				this.updateHeaderText(this.getClosestGroupId(grpId).toUpperCase());
			}

			// scroll list container into view. Temporarily suspend scroll events
			// so as not to invoke another call to renderOnScroll. Must update
			// scroller boundary to make sure scroll position in bounds.
			this.scroller.updateBoundary();
			this.scroller.suspendEvents();
			this.scroller.scrollTo({x: 0, y: this.topProxy.getHeight()}, false);
			this.scroller.resumeEvents();
		}
	},
	
	// @private - override
	onItemDeselect: function(record) {
        var node = this.getNode(record);
        if ( node ) {
        	Ext.fly(node).removeCls(this.selectedItemCls);
        }
    },

    // getNode just compensates for the offset between the record index of
	// our first rendered item and zero.
    // @private - override
    getNode : function(nodeInfo) {
		nodeInfo = nodeInfo instanceof Ext.data.Model ? this.indexOfRecord(nodeInfo) : nodeInfo;
		if ( Ext.isNumber(nodeInfo) ) {
			return this.isItemRendered(nodeInfo) ? 
				this.all.elements[nodeInfo - this.topItemRendered] : null;
		}
		return Ext.ux.BufferedList.superclass.getNode.call(this, nodeInfo);
	},

	// @private - called on Add, Remove, Update, and cleanup.
	updateItemList: function() {
		// Update simply re-renders this.minimumItems item nodes, starting with the first visible
		// item, and then restores any item selections. The current scroll position
		// of the first visible item will be maintained.
		this.isUpdating = true;
		var visItems = this.getVisibleItems(true);
		var startItem = visItems.length ? visItems[0] : 0;
			// save selections
		var selectedRecords = this.getSelectedRecords();
		// replace items
		this.replaceItemList(startItem,this.minimumItems);
		// restore selections
		var i, node;
		for ( var i = 0; i < selectedRecords.length; i++ ) {
			node = this.getNode(selectedRecords[i]);
			if ( node ) {
				Ext.fly(node).addCls(this.selectedItemCls);
			}
		}
		this.isUpdating = false;
	},
	
	// each of the data store modifications is handled by the updateItemList
	// function, which will ensure that the currently visible items reflect
	// the latest state of the store.
	// @private - override
	onUpdate : function(store, record) {
		if (this.grouped) {
			this.initGroupIndexMap();
		}
		this.updateItemList();
    },

    // @private - override
    onAdd : function(ds, records, index) {
		if (this.grouped) {
			this.initGroupIndexMap();
		}
		this.updateItemList();
    },

    // @private - override
    onRemove : function(ds, record, index) {
		if (this.grouped) {
			this.initGroupIndexMap();
		}
		this.updateItemList();
    },
    
    onBeforeHide: function() {
		// Stop the scroller when this component is hidden, e.g. when switching
    	// tabs in a tab panel.
    	var sc = this.scroller;
    	sc.suspendEvents();
		sc.scrollTo({x:0,y:sc.getOffset().y});
		sc.resumeEvents();
		return true;
    }


});
