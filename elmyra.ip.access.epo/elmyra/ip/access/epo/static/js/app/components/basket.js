// -*- coding: utf-8 -*-
// (c) 2013,2014 Andreas Motl, Elmyra UG

BasketModel = Backbone.RelationalModel.extend({

    sync: Backbone.localforage.sync('Basket'),

    relations: [
        {
            type: Backbone.HasMany,
            key: 'entries',
            relatedModel: 'BasketEntryModel',
            includeInJSON: Backbone.Model.prototype.idAttribute,

            /*
            reverseRelation: {
                type: Backbone.One,
                key: 'basket',
                // 'relatedModel' is automatically set to 'ProjectModel'
                includeInJSON: Backbone.Model.prototype.idAttribute,
            },
            */

        }
    ],

    defaults: {
    },

    initialize: function() {
        console.log('BasketModel.initialize');
        // backbone-relational backward-compat
        if (!this.fetchRelated) this.fetchRelated = this.getAsync;
    },

    // initialize model from url query parameters ("numberlist")
    init_from_query: function() {
        var deferreds = [];
        var _this = this;

        var numberlist = opsChooserApp.config.get('numberlist');

        if (numberlist) {
            numberlist = decodeURIComponent(numberlist);
            var entries = numberlist.split(/[,\n]/);
            _(entries).each(function(entry) {
                var deferred = _this.add(entry.trim());
                deferreds.push(deferred);
            });
        }

        // wait for all add operations to finish before signalling success
        return deferreds_bundle(deferreds);
    },

    get_entry_by_number: function(item) {
        var entrymodels = this.get('entries').where({number: item});
        if (_.isEmpty(entrymodels)) {
            return;
        } else {
            return entrymodels[0];
        }
    },

    // add item to basket
    add: function(number) {
        var _this = this;

        var deferred = $.Deferred();

        var entry = this.get_entry_by_number(number);
        if (entry) {

            // refetch entry to work around localforage.backbone vs. backbone-relational woes
            // otherwise, data storage mayhem may happen, because of model.id vs. model.sync.localforageKey mismatch
            entry.fetch({success: function() {
                deferred.resolve(entry);

                // refresh gui, update timestamp
                _this.trigger('change', _this);
            }});

            return deferred.promise();
        }

        // get title of selected document
        // TODO: maybe prebuild/maintain an index in collection
        var document = _.find(opsChooserApp.documents.models, function(doc) {
            var document_number = doc.get_document_number();
            return number == document_number;
        });
        var title = document ? document.attributes.get_title_list() : undefined;

        // build basket entry
        entry = new BasketEntryModel({
            number: number,
            timestamp: now_iso(),
            title: title,
            /*basket: this,*/
            /*query: null,*/
        });

        // save basket entry
        entry.save(null, {success: function() {
            var entries = _this.get('entries');
            entries.add(entry);
            _this.save({'entries': entries}, {
                success: function() {
                    $.when(_this.fetch_entries()).then(function() {
                        //deferred.resolve(entry);
                        deferred.resolve(_this.get_entry_by_number(entry.get('number')));
                        _this.trigger('change', _this);
                        _this.trigger('change:add', entry, number);
                    });
                },
            });
        }});

        return deferred.promise();
    },

    // remove item from basket
    remove: function(number) {
        var _this = this;

        var entry = this.get_entry_by_number(number);
        if (!entry) {
            return;
        }

        var entries = this.get('entries');
        entries.remove(entry);
        entry.destroy();
        _this.save({'entries': entries}, {success: function() {
            $.when(_this.fetch_entries()).then(function() {
                _this.trigger('change:remove', entry, number);
                _this.trigger('change', _this);
            });
        }});
    },

    get_numbers: function() {
        return this.get('entries').invoke('get', 'number');
    },

    review: function(options) {

        var publication_numbers = this.get_numbers();
        var hits = publication_numbers.length;

        // TODO: decouple from referencing the main application object e.g. by using events!?
        opsChooserApp.set_datasource('review');
        opsChooserApp.metadata.set('reviewmode', true);
        opsChooserApp.perform_listsearch(options, undefined, publication_numbers, hits, 'pn', 'OR');
    },

    // fetch all basket entries from datastore, one by one; this is nasty
    fetch_entries: function() {

        var _this = this;
        var main_deferred = $.Deferred();
        $.when(this.fetchRelated('entries')).then(function() {

            // TODO: refactor this to some common base class or mixin
            var deferreds = [];
            _this.get('entries').each(function(entry) {

                // prepare a deferred which will get resolved after successfully fetching an item from datastore
                var deferred = $.Deferred();
                deferreds.push(deferred.promise());

                entry.fetch({
                    success: function() {
                        deferred.resolve(entry);
                    },
                    error: function() {
                        // HACK: sometimes, the item has vanished while fetching from store, so let's recreate it
                        console.log('error while fetching basket entry:', entry);
                        entry.save(null, {
                            success: function() {
                                console.log('success');
                                deferred.resolve(entry);
                            },
                            error: function() {
                                console.log('error');
                                deferred.resolve(entry);
                            },
                        });
                    }
                });
            });

            $.when.apply($, deferreds).then(function() {
                main_deferred.resolve();
            });
        });

        return main_deferred.promise();

    },

    get_view_state: function(more) {

        more = more || {};

        var projectname = opsChooserApp.project.get('name');
        var numbers = this.get_numbers();
        var numbers_string = numbers.join(',');

        var state = {
            //mode: 'liveview',
            context: 'viewer',
            project: projectname,
            query: undefined,
            datasource: 'review',
            numberlist: numbers_string,
        };

        _(state).extend(more);

        return state;

    },

});


BasketEntryModel = Backbone.RelationalModel.extend({

    sync: Backbone.localforage.sync('BasketEntry'),

    defaults: {
        number: undefined,
        timestamp: undefined,
        title: undefined,
        score: undefined,
        dismiss: undefined,
        // TODO: link to QueryModel
        //query: undefined,
    },

    initialize: function() {
        console.log('BasketEntryModel.initialize');
    },
});

BasketView = Backbone.Marionette.ItemView.extend({

    template: "#basket-template",

    initialize: function() {
        console.log('BasketView.initialize');
        this.listenTo(this.model, "change", this.render);
        this.listenTo(this, "item:rendered", this.setup_ui);
        this.templateHelpers.config = opsChooserApp.config;
    },

    templateHelpers: {},

    serializeData: function() {

        var data = {};
        data = this.model.toJSON();

        var entries = this.model.get('entries').map(function(entry) {
            var line =
                _.string.ljust(entry.get('number'), 20, ' ') +
                _.string.ljust(entry.get('dismiss') ? '∅' : '', 5, ' ') +
                _.string.repeat('★', entry.get('score'));
            return line;
        });

        //var numbers = this.model.get_numbers();
        if (entries) {
            data['numbers_display'] = entries.join('\n');
        }

        return data;

    },

    setup_ui: function() {
        console.log('BasketView.setup_ui');

        var _this = this;

        // basket import
        $('#basket-import-button').click(function(e) {
            _this.future_premium_feature();
            return false;
        });

        // only enable submit button, if ship url is given
        var ship_url = opsChooserApp.config.get('ship-url');
        if (ship_url) {
            $('#basket-submit-button').prop('disabled', false);
        } else {
            $('#basket-submit-button').prop('disabled', true);
        }

        // review feature: trigger search from basket content
        $('.basket-review-button').unbind('click');
        $('.basket-review-button').click(function() {
            _this.model.review();
        });

        // basket sharing
        $('#share-numberlist-email').unbind('click');
        $('#share-numberlist-email').click(function() {

            var projectname = opsChooserApp.project.get('name');
        // share via url
        $('#share-numberlist-url').unbind('click');
        $('#share-numberlist-url').click(function() {
            var url = opsChooserApp.permalink.make_uri(_this.model.get_view_state());
            $(this).attr('href', url);
        });

            var numbers = _this.model.get_numbers();
            var numbers_count = numbers.length;
            var numbers_string = numbers.join('\n');

            var subject = _.template('[IPSUITE] Shared <%= count %> patent numbers through project <%= projectname %> at <%= date %>')({
                count: numbers_count,
                date: now_iso_human(),
                projectname: projectname,
            });
            var body = numbers_string + '\r\n\r\n--\r\nPowered by https://patentsearch.elmyra.de/';
            var mailto_link = _.template('mailto:?subject=<%= subject %>&body=<%= body %>')({
                subject: encodeURIComponent(subject),
                body: encodeURIComponent(body),
            });
            $(this).attr('href', mailto_link);
        });

        // share via document transfer
        $('#share-documents-transfer').unbind('click');
        $('#share-documents-transfer').click(function() {
            _this.future_premium_feature();
        });

        // display number of entries in basket
        var entry_count = this.model.get('entries').length;
        $('.basket-entry-count').text(entry_count);

    },

    future_premium_feature: function() {
        bootbox.dialog(
            'Available soon via subscription.', [{
                "label": 'OK',
                "icon" : 'OK',
                "callback": null,
            }],
            {header: 'Future feature'});
    },

    onDomRefresh: function() {
        console.log('BasketView.onDomRefresh');
    },

    // backpropagate current basket entries into action state (rating, signal coloring, etc.)
    link_document: function(entry, number) {

        // why do we have to access the global object here?
        // maybe because of the event machinery which dispatches to us?
        var numbers = opsChooserApp.basketModel.get_numbers();

        var checkbox_element = $('#chk-patent-number-' + number);
        var add_button_element = $('#add-patent-number-' + number);
        var remove_button_element = $('#remove-patent-number-' + number);
        var rating_widget = $('#rate-patent-number-' + number);
        var indicator_element = rating_widget.closest('.ops-collection-entry-heading');

        // number is not in basket, show "add" button
        if (!_(numbers).contains(number)) {
            checkbox_element && checkbox_element.prop('checked', false);
            add_button_element && add_button_element.show();
            remove_button_element && remove_button_element.hide();

            // clear rating widget
            rating_widget.raty('reload');

            // clear color indicators
            indicator_element.toggleClass('dismiss', false);
            indicator_element.toggleClass('score1', false);
            indicator_element.toggleClass('score2', false);
            indicator_element.toggleClass('score3', false);

            // number is already in basket, show "remove" button and propagate rating values
        } else {
            checkbox_element && checkbox_element.prop('checked', true);
            add_button_element && add_button_element.hide();
            remove_button_element && remove_button_element.show();

            // if we have a model, propagate "score" and "dismiss" values
            if (entry) {
                var score = entry.get('score');
                var dismiss = entry.get('dismiss');

                // a) to rating widget
                rating_widget.raty('score', score);
                rating_widget.raty('dismiss', dismiss);

                // b) to color indicator
                indicator_element.toggleClass('dismiss', Boolean(dismiss));
                indicator_element.toggleClass('score1', score == 1);
                indicator_element.toggleClass('score2', score == 2);
                indicator_element.toggleClass('score3', score == 3);

            }

        }

    },

    textarea_scroll_bottom: function() {
        $('#basket').scrollTop($('#basket')[0].scrollHeight);
    },

    textarea_scroll_text: function(text) {
        var textArea = $('#basket');
        var index = textArea.text().search(text);
        if (index) {
            textArea.scrollTop(index);
        }
    },

});


// setup plugin
opsChooserApp.addInitializer(function(options) {

    // Special bootstrap handling for datasource=review:
    // This activates the review after both the application
    // and the basket signal readyness.
    this.listenTo(this, 'application:ready', function() {
        if (this.config.get('datasource') == 'review') {
            this.listenToOnce(this, 'basket:activated', function(basket) {
                $.when(basket.init_from_query()).then(function() {
                    basket.review();
                });
            });
        }
    });

});
