# -*- coding: utf-8 -*-
# (c) 2014 Andreas Motl, Elmyra UG
import json
import logging
from pyramid.settings import asbool     # required by template
from pyramid.threadlocal import get_current_request

log = logging.getLogger(__name__)

class BackboneModelParameterFiddler(object):
    """all parameter fiddling in one single place :-)"""

    # TODO: refactor IpsuiteNavigatorConfig.defaults here as well, trim down config.js

    def __init__(self, name):
        self.name = name

    def settings(self):
        """define default settings"""

        request = get_current_request()

        data = {
            'app.software.version': request.registry.settings.get('SOFTWARE_VERSION', ''),
            'ui.version': 'Software release: ' + request.registry.settings.get('SOFTWARE_VERSION', ''),
            'ui.page.title': 'Patent search',
            'ui.page.subtitle': '',
            'ui.page.footer': 'Data sources: EPO/OPS, DPMA/DEPATISnet, USPTO/PATIMG',
            'ui.productname': 'elmyra <i class="circle-icon">IP</i> suite',
        }

        # prefix settings in confiuration model
        realdata = {}
        for key, value in data.iteritems():
            key = 'setting.' + key
            realdata[key] = value
        return realdata

    def compute_parameters(self):

        request = get_current_request()

        setting_params = dict(self.settings())
        request_params = dict(request.params)
        request_opaque = dict(request.opaque)


        # A. parameter firewall
        host = request.headers.get('Host')
        isviewer = host == 'patentview.elmyra.de'

        # 1. don't allow "query" from outside on viewer-only domains
        if request_params.has_key('query') and isviewer:
            log.warn('parameter "query=%s" not allowed on this instance, deleting it', request_params['query'])
            del request_params['query']


        # B. merge parameters
        # 1. use "settings" as foundation
        # 2. merge "request parameters"
        # 3. merge "opaque parameters" taking the highest precedence
        params = setting_params
        params.update(request_params)
        params.update(request_opaque)


        # C. special customizations

        # 1. on patentview.elmyra.de, only run liveview
        if isviewer:
            params['mode'] = 'liveview'
            params['setting.ui.page.title'] = 'Patent view'


        # D. backward-compat amendments
        for key, value in params.iteritems():
            if key.startswith('ship_'):
                newkey = key.replace('ship_', 'ship-')
                params[newkey] = value
                del params[key]

        return params

    def render(self):
        """transfer parameters to Backbone model"""
        parameters = self.compute_parameters()
        javascript = self.name + '.set(' + json.dumps(parameters) + ');\n'
        return javascript

fiddler = BackboneModelParameterFiddler('ipsuiteNavigatorConfig')
