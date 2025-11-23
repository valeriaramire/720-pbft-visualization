import logo from './logo.svg';
import './App.css';
import React, { useState, useCallback } from 'react';
import 'devextreme/dist/css/dx.light.css';
import { TextBox } from 'devextreme-react/text-box';
import { Switch } from "devextreme-react/switch";
import RangeSlider, { Tooltip, Label } from 'devextreme-react/range-slider';

function Text() {
        const onValueChanged = useCallback((e) => {
            // https://js.devexpress.com/React/Documentation/Guide/UI_Components/Switch/Getting_Started_with_Switch/
            const stateLabel = e.value ? "ON" : "OFF";
            
        }, []);
        return (
            <div>
                <div>
                    <h4>Start or Stop the Visualization Tool</h4>
                    <Switch
                        width={80}
                        rtlEnabled={true}
                        onValueChanged={onValueChanged}
                    />
                </div>
                <h4>
                    Set the number of Replicas
                </h4>
                <RangeSlider min={0} max={50} showRange={true} width={500}>
                    <Tooltip
                        enabled={true}
                        showMode="always"
                        position="bottom"
                    />
                </RangeSlider>
                
            </div>
        );
    }

export default Text;

//https://js.devexpress.com/React/Demos/WidgetsGallery/Demo/RangeSlider/Overview/MaterialBlueLight/
