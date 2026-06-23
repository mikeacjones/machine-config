#!/bin/bash

minikube start --driver=docker -p temp

read -p "Press ENTER to exit and cleanup..."

minikube delete -p temp
